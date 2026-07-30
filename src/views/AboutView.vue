<script setup>
/**
 * Method.
 *
 * The written half of the project. Someone who reads only this page should
 * understand what problem was solved, why a graph network is the right tool
 * for it, and what was built by hand versus pulled off a shelf.
 */
import { computed } from 'vue';
import { useGridStore } from '@/stores/grid.js';

const store = useGridStore();
const report = computed(() => store.modelReport);
</script>

<template>
  <div class="shell">
    <header class="head">
      <p class="eyebrow">Method</p>
      <h1>How GridSentinel works</h1>
      <p class="lede">
        A power grid is a graph whose failures propagate along its edges. That is not a metaphor reached for after
        picking the model; it is the reason the model is the right one.
      </p>
    </header>

    <article class="prose">
      <section>
        <h2>The problem</h2>
        <p>
          Grid operators run contingency analysis continuously: for every credible failure, what happens next? The hard
          part is that failures do not stay put. When a transmission circuit opens, its power has to go somewhere. It
          redistributes across the remaining circuits according to their impedances, and if that pushes another circuit
          past its thermal rating, protection opens that one too. Repeat. Every large blackout on record;
          the 2003 Northeast event, Italy the same year, followed that loop.
        </p>
        <p>
          The consequence that matters is not which circuits opened. It is whether the network fragmented into islands,
          and whether each island still contains enough generation to serve the load trapped inside it. An island with
          no generator goes dark completely. An island short of generation sheds load until it balances.
        </p>
        <p class="callout">
          This is why a bus's own measurements cannot answer the question. A perfectly healthy substation with light
          load and new equipment goes dark anyway if the only path to generation runs through two circuits that fail
          together. The answer lives in the topology.
        </p>
      </section>

      <section>
        <h2>The simulator</h2>
        <p>
          There is no public dataset of labelled cascade outcomes, so the project builds its own. A generator produces
          transmission networks from a seed: buses scattered around a few load centres, a spanning-tree backbone
          reinforced with short redundant circuits, generation sited away from load, heavy-tailed industrial demand, and
          a drifting weather field that raises failure hazard where it sits.
        </p>
        <p>
          Circuits are then sized the way a planning study would size them, by iterating until the intact network runs
          below about 72% loading everywhere. Without that step the generated grids start out already overloaded and the
          labels degenerate into noise.
        </p>
        <p>
          Load flow uses the DC approximation; flat voltages, small angle differences, negligible resistance, which
          reduces the problem to a linear system per island and is the standard screening model in the industry.
          Generation dispatches proportionally to capacity; islands short of generation shed whole buses in the order a
          real under-frequency scheme would drop them, lowest voltage class and least interconnected first.
        </p>
        <p>
          The label for each grid comes from running every single-circuit outage to completion, weighting each by a
          hazard that combines how hard the circuit is being worked, its condition, and the weather over its
          right-of-way. A bus's risk is the hazard-weighted share of contingencies in which it lost service. That study
          is the expensive thing the network is trained to imitate.
        </p>
      </section>

      <section>
        <h2>The network</h2>
        <p>
          TopoRiskNet is an edge-gated variant of GraphSAGE. Each layer builds a message from every neighbouring bus,
          multiplies it elementwise by a gate computed from the connecting circuit's own state, mean-aggregates the
          gated messages, and mixes them with the bus's own representation through a residual, layer-normalised block.
        </p>
        <p>
          The gate is the part that is specific to this problem. In a power system a neighbour only matters to the
          extent that the circuit between you can actually deliver power. A circuit running at 95% of its rating through
          a storm is a weak coupling; a lightly loaded double circuit is a strong one. Plain neighbourhood averaging
          cannot express that difference, so the gate is conditioned on the eight per-circuit features and learns it.
        </p>
        <p>
          There are
          <template v-if="report">{{ report.architecture.layers }}</template>
          <template v-else>four</template>
          rounds of message passing, which sets how far information travels. Fewer than that and buses at the end of
          long radial chains were systematically underscored; they could not see far enough to find out whether there
          was generation on the other side.
        </p>
        <p>
          Two heads share the trunk. The bus head also receives the raw input features alongside the learned embedding,
          so local evidence survives the message-passing stack. The circuit head is deliberately symmetric in its
          endpoints; it sees their sum and their absolute difference rather than a concatenation, because a circuit
          has no direction and the representation should not invent one.
        </p>
      </section>

      <section>
        <h2>Built by hand, and why</h2>
        <p>
          The automatic differentiation engine, the optimiser, the message passing and the model are all written from
          scratch in about six hundred lines of JavaScript. That was a deliberate choice rather than an exercise.
        </p>
        <p>
          The app is a static site with no backend, so the model has to run in the browser tab. Shipping a training
          framework to do that is not viable. More importantly, writing one forward pass means the network scoring your
          grid right now is provably the network that produced the metrics on the model card; the training script and
          the browser import the same file. Train/serve skew is a whole category of bug that gets designed out rather
          than tested for.
        </p>
        <p>
          Hand-written gradients need proof, so the repository includes a finite-difference gradient check that
          perturbs sampled parameters and compares the analytic gradient against a numerical one. It runs with
          <code>npm run verify</code> and currently agrees to within about 5&times;10<sup>-8</sup>.
        </p>
        <p class="callout callout--note">
          Worth saying plainly: an early version of this trained to a flat line because a guard in the backward pass was
          skipping intermediate tensors, so gradients were silently zero. The loss plateaued at exactly the value you
          get by predicting 0.5 for everything. The gradient check exists because of that afternoon.
        </p>
      </section>

      <section>
        <h2>Honest accounting</h2>
        <p>
          The speedup on a small grid is unimpressive, and the model card shows it rather than hiding it. A 40-bus study
          finishes fast enough that a surrogate saves little. The argument is about slope: the study has to factorise
          the network once per contingency, so its cost grows with roughly the cube of the bus count, while the
          network's cost grows linearly. By 160 buses the gap is already several-fold, and real interconnections have
          thousands.
        </p>
        <p>
          Circuit ranking is another place where the graph barely beats the baseline, because that question is mostly
          answerable from the two endpoints and the circuit itself. Reporting only the bus metric would have made the
          project look stronger and meant less.
        </p>
        <p>
          Everything here runs on simulated data. That is a real limitation, not a footnote. What the project
          demonstrates is the method; problem framing, an inductive bias matched to the physics, a controlled ablation,
          calibration, and a surrogate that is honest about where it helps.
        </p>
      </section>

      <section>
        <h2>Running it yourself</h2>
        <p>Everything regenerates from source. Nothing in the repository is a cached artefact you have to trust.</p>
        <pre class="code"><code>npm install
npm run verify   # simulator invariants + autograd gradient check
npm run ml       # regenerate the dataset and retrain (~8 min)
npm run dev      # local development server
npm run build    # static bundle in dist/</code></pre>
        <p>
          <code>npm run ml</code> rewrites the model weights and the training report, and the model card reads straight
          from that report; so if you retrain, this site updates itself.
        </p>
      </section>
    </article>
  </div>
</template>

<style scoped>
.head {
  padding: 8px 0 26px;
}
.head h1 {
  margin: 9px 0 12px;
}
.lede {
  font-size: 16px;
  color: var(--ink-2);
  max-width: 70ch;
  margin: 0;
}

.prose {
  max-width: 74ch;
}

.prose section {
  padding: 24px 0;
  border-top: 1px solid var(--rule);
}
.prose section:first-child {
  border-top: none;
  padding-top: 4px;
}

.prose h2 {
  margin-bottom: 14px;
}

.prose p {
  font-size: 14.5px;
  color: var(--ink-2);
  line-height: 1.62;
  margin-bottom: 15px;
}
.prose p:last-child {
  margin-bottom: 0;
}

.callout {
  padding: 13px 16px;
  border-left: 3px solid var(--indigo);
  background: var(--paper-2);
  color: var(--ink) !important;
  font-size: 14px !important;
}
.callout--note {
  border-left-color: var(--watch);
}

.code {
  background: var(--panel);
  color: var(--panel-ink);
  padding: 15px 17px;
  border-radius: var(--radius-lg);
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.75;
  margin: 0 0 15px;
}
.code code {
  font-family: var(--font-mono);
}

.prose code {
  background: var(--paper-2);
  border: 1px solid var(--rule-soft);
  border-radius: 2px;
  padding: 1px 5px;
  font-size: 0.88em;
}
.code code {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
}
</style>
