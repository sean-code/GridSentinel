import { createRouter, createWebHistory } from 'vue-router';

/**
 * Routes are lazy so the model card's charts and the method write-up are not
 * in the critical path for the board, which is what people come for.
 */
const routes = [
  { path: '/', name: 'operations', component: () => import('@/views/OperationsView.vue'), meta: { title: 'Operations' } },
  { path: '/cascade', name: 'cascade', component: () => import('@/views/CascadeView.vue'), meta: { title: 'Cascade lab' } },
  { path: '/model', name: 'model', component: () => import('@/views/ModelView.vue'), meta: { title: 'Model card' } },
  { path: '/about', name: 'about', component: () => import('@/views/AboutView.vue'), meta: { title: 'Method' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, saved) {
    return saved || { top: 0 };
  },
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · GridSentinel` : 'GridSentinel';
});

export default router;
