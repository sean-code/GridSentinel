# GridSentinel

**A graph neural network that predicts cascading outage risk on a power transmission network:**

Live demo: _add your Vercel URL here_

---

## What it does

Grid operators run contingency analysis continuously: for every credible circuit failure, what happens next? The hard part is that failures do not stay put. When a transmission circuit opens, its power redistributes across the remaining circuits; if that pushes another past its thermal rating, protection opens that one too. The network can fragment into islands, and any island without enough generation sheds load or goes dark.

GridSentinel trains a graph neural network to predict the outcome of that study directly from the intact grid, without simulating anything.

Two outputs:

- **per bus** — probability of losing service in the next credible circuit outage
- **per circuit** — share of system load lost if that circuit opens

**Why a graph network is the right tool here:** a bus's own measurements cannot answer the question. A healthy substation with light load and new equipment still goes dark if the only path to generation runs through two circuits that fail together. The answer lives in the topology, which is exactly what message passing can see and a feature vector cannot.

---

## Results

Held out on 140 grids the model never saw, with disjoint seed ranges so no grid can leak between splits.

| Metric | Graph network | Graph-blind baseline | Δ |
|---|---:|---:|---:|
| Bus risk ROC-AUC | **0.886** | 0.770 | +0.117 |
| Bus risk average precision | **0.675** | 0.429 | +0.246 |
| Bus risk Brier score | **0.151** | 0.172 | −0.021 |
| Bus risk mean absolute error | **0.046** | 0.062 | −0.016 |
| Circuit criticality (Spearman) | 0.739 | 0.731 | +0.008 |
| Circuit top-5 precision | 0.559 | 0.541 | +0.017 |

**The baseline is the point.** It is the same architecture with the message-passing path removed — an MLP over *identical* per-bus features. Every feature the graph model sees, the baseline also sees. The only difference is that one of them gets to know how the buses are wired together. If topology were decoration, the columns would match.

Circuit ranking is where the graph barely wins, and the model card says so. That question is mostly answerable from the two endpoints and the circuit's own state, which the baseline already has. Reporting only the bus metric would have looked stronger and meant less.

### Cost against system size

The surrogate replaces a study whose cost grows with roughly the cube of the bus count, because it factorises the network once per contingency.

| Buses | Circuits | N-1 study | TopoRiskNet | Speedup |
|---:|---:|---:|---:|---:|
| 40 | 61 | 7.4 ms | 5.1 ms | 1× |
| 70 | 103 | 13.1 ms | 7.8 ms | 2× |
| 110 | 173 | 59.1 ms | 12.2 ms | 5× |
| 160 | 269 | 117.8 ms | 18.4 ms | 6× |

On a small grid the speedup is unimpressive and the site shows it rather than hiding it. It is the **slope** that makes the case — real interconnections have thousands of buses, far to the right of anything measured here.

### Generalisation across graph size

Trained on 30–66 bus grids, then evaluated outside that range. Rank agreement with the full physics study:

| Buses | 38 | 62 | 88 | 120 |
|---|---:|---:|---:|---:|
| Spearman ρ | 0.72 | 0.62 | 0.81 | 0.83 |

Size generalisation comes free with message passing; the same weights apply to a graph of any size.

---

## Architecture

**TopoRiskNet** — an edge-gated GraphSAGE variant, 4 layers, 48 hidden units, ~36k parameters.

```
per bus (16 features) ──► encoder ──► LayerNorm ──► LeakyReLU
                                          │
        ┌─────────────────────────────────┴──────────────── ×4 ────┐
        │  message  = W_msg · h[neighbour]                          │
        │  gate     = σ(W_gate · e[circuit])      ◄── edge-gated    │
        │  aggregate= mean(message ⊙ gate)                          │
        │  h        = h + LeakyReLU(LayerNorm(W_self·h + W_nb·agg)) │
        └───────────────────────────────────────────────────────────┘
                                          │
                            ┌─────────────┴─────────────┐
                    bus head [h ‖ x]            circuit head [hᵤ+hᵥ ‖ |hᵤ−hᵥ| ‖ e]
                       → σ(risk)                       → σ(criticality)
```

Three decisions that are specific to this problem:

1. **The edge gate.** In a power system a neighbour only matters to the extent that the circuit between you can deliver power. A circuit at 95% of rating through a storm is a weak coupling; a lightly loaded double circuit is a strong one. Plain neighbourhood averaging cannot express that, so the gate is conditioned on the eight per-circuit features.

2. **Four layers, not two.** A bus's fate depends on whether the island it lands in still has generation, a question about a neighbourhood several hops wide. With fewer layers, buses at the end of long radial chains were systematically underscored.

3. **A symmetric circuit head.** It sees the endpoints' sum and absolute difference rather than a concatenation, because a circuit has no direction and the representation should not invent one.

The bus head also receives the raw input features alongside the learned embedding, so local evidence survives the message-passing stack.

---

## The simulator

No public dataset of labelled cascade outcomes exists, so the project generates its own. Everything derives from a single integer seed and reproduces byte-identically in Node and the browser.

**Topology** — buses scattered around a few load centres, a Euclidean spanning-tree backbone reinforced with short redundant circuits, generation sited away from load, heavy-tailed industrial demand, and a drifting weather field that raises failure hazard where it sits.

**Planning pass** — circuits are resized iteratively until the intact network runs below ~72% loading everywhere, the way a real planning study would size them. Without this the generated grids start out already overloaded and the labels degenerate into noise.

**Load flow** — the DC approximation (flat voltages, small angles, negligible resistance), which reduces the problem to a linear system per island and is the standard screening model for contingency ranking.

**Cascade** — trip a circuit, re-island, redispatch, shed load where generation is short, resolve flows, trip anything beyond its emergency rating, repeat. Under-frequency shedding drops buses in the order a real scheme would: lowest voltage class and least interconnected first.

**Labels** — every single-circuit outage run to completion, weighted by a hazard combining circuit loading, condition, and weather exposure. A bus's risk is the hazard-weighted share of contingencies in which it lost service.

The corpus is 650 grids and ~46,000 simulated contingencies.

---

## Built from scratch, and why

The automatic differentiation engine, the Adam optimiser, the message passing and the model are all hand-written JavaScript — no PyTorch, no TensorFlow.js.

This was a constraint-driven choice, not an exercise:

- The app is a **static site with no backend**, so the model must run in the browser tab. Shipping a training framework to do that is not viable.
- **One forward pass serves both training and inference.** `ml/train.js` and the browser import the same `shared/model.js`. The network scoring your grid is provably the network that produced the metrics on the model card. Train/serve skew is designed out rather than tested for.

Hand-written gradients need proof, so `ml/gradcheck.js` perturbs sampled parameters and compares analytic gradients against finite differences. Current worst relative error: **5×10⁻⁸**.

> That check exists for a reason. An early version trained to a flat line because a guard in the backward pass was skipping intermediate tensors, so gradients were silently zero. The loss plateaued at exactly the value you get by predicting 0.5 for everything.

---

## Running it

```bash
npm install

npm run verify      # simulator invariants + gradient check + end-to-end
npm run dev         # development server at localhost:5173
npm run build       # static bundle in dist/
```

Retraining regenerates the dataset from scratch and rewrites both the weights and the training report:

```bash
npm run ml          # ~8 minutes on one core
```

The model card page reads directly from `public/model/training-report.json`, so **retraining updates the site's own documentation**. Nothing on that page is typed in by hand.

Other scripts:

```bash
npm run train:quick             # small corpus, few epochs — for iterating
npm run board > board.svg       # render the network diagram standalone
```

---

## Deploying

The build is a static bundle. Any static host works; Vercel is one click.

1. Create an empty repository on GitHub and push this project to it.
2. On [vercel.com](https://vercel.com), **Add New → Project**, import the repository.
3. Vercel detects Vite from `vercel.json`. Framework `Vite`, build `npm run build`, output `dist`. Deploy.

`vercel.json` already handles SPA routing (so `/model` works on a hard refresh) and long-lived caching for the weights.

**A free domain.** Every deploy gets a free `your-project.vercel.app` subdomain, which is fine for a resume link. For a custom one:

- **[is-a.dev](https://github.com/is-a-dev/register)** — free `yourname.is-a.dev`, by pull request. Well suited to a developer portfolio.
- **[js.org](https://github.com/js-org/js.org)** — free `yourproject.js.org` for JavaScript projects.
- **[EU.org](https://nic.eu.org/)** — free permanent domains, slower approval.
- **Cloudflare Registrar** — not free, but at-cost (~$10/year) with no markup.

Add the domain in Vercel under **Settings → Domains** and point the DNS record it shows you.

---

## Project layout

```
shared/          code that runs in BOTH Node and the browser
  rng.js           seeded PRNG — reproducibility across environments
  grid.js          network generator, topology, features
  powerflow.js     DC load flow, dispatch, load shedding, cascades
  features.js      feature extraction (identical at train and serve time)
  autograd.js      reverse-mode autodiff over dense matrices
  model.js         TopoRiskNet + the graph-blind ablation

ml/              training pipeline (Node only)
  dataset.js       scenario sampling and label generation
  train.js         trains both models, evaluates, benchmarks, exports
  metrics.js       ROC-AUC, average precision, Brier, Spearman, P@k
  gradcheck.js     finite-difference verification of the autograd
  verify.js        simulator invariants
  e2e.js           loads shipped weights and exercises browser code paths

src/             Vue 3 application
  components/      MimicBoard, RiskLedger, BusInspector, HeadToHead, …
  views/           Operations, Cascade lab, Model card, Method
  stores/grid.js   Pinia store — grid, prediction, physics study
  lib/             inference, chunked async study, formatting

public/model/    exported weights + training report (regenerated by npm run ml)
```

---

## Limitations

Stated plainly, because a surrogate model that oversells itself is worse than useless.

- **Trained on simulated grids.** The generator produces networks that behave plausibly, but no utility data went into this, and none of these numbers transfer to a real system without retraining on one.
- **DC approximation.** No reactive power, no voltage collapse, no resistance. Correct for contingency *ranking*, not an AC solution.
- **N-1 only.** Real operators also plan for N-1-1 and common-mode failures.
- **A triage tool, not a replacement.** The right use is deciding which of a thousand cases deserves the exact study. Anything that actually gets switched should still be simulated properly.
- **Only valid inside its envelope.** ~48-bus grids on average, with the load and weather ranges in the model card. The calibration curve does not apply far outside that.

---

## Stack

Vue 3 (Composition API) · Vite · Pinia · Vue Router · hand-written autodiff and GNN · zero runtime ML dependencies · static deploy

MIT licensed. The simulated data and the trained weights are yours to reuse.
