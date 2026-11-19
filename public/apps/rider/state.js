// Central rider state + tiny pub/sub. Views read `state` and subscribe to the
// bus for cross-view updates (jobs, earnings, online presence).
import { api, getToken, setToken } from '../_shared/api.js';

const listeners = new Map();
export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event)?.delete(fn);
  },
  emit(event, payload) { listeners.get(event)?.forEach(fn => { try { fn(payload); } catch { /* isolate */ } }); },
};

export const state = {
  user: null,
  ready: false,
  rider: null,      // {id,name,phone,vehicle,home_store_id,is_online,location}
  jobs: [],         // jobView[] — offered first, then active, then history
  earnings: null,   // {today,week,all_time}
  online: false,
};

export async function refreshJobs() {
  try {
    const res = await api.riderJobs();
    state.jobs = res.jobs || [];
    bus.emit('jobs', state.jobs);
  } catch { /* keep last known jobs */ }
  return state.jobs;
}

export async function refreshEarnings() {
  try {
    const res = await api.riderEarnings();
    state.earnings = res.earnings || null;
    bus.emit('earnings', state.earnings);
  } catch { /* keep last known earnings */ }
  return state.earnings;
}

/** Flip availability, then pull jobs (going online can instantly offer one). */
export async function setOnline(online) {
  const res = await api.riderAvailability(Boolean(online));
  state.rider = res.rider || state.rider;
  state.online = Boolean(state.rider?.is_online);
  bus.emit('online', state.online);
  await refreshJobs();
  return state.online;
}

export async function bootstrap() {
  const me = await api.me();
  const user = me.user || me;
  if (user?.role !== 'rider') {
    // All apps share the 'kc-v2-token' key — drop a non-rider session cleanly
    // instead of hammering rider endpoints with 403s.
    setToken('');
    state.user = null;
    state.ready = false;
    const error = new Error('This account is not a rider. Sign in with a rider number (e.g. 90000 00011).');
    error.code = 'NOT_RIDER';
    throw error;
  }
  state.user = user;
  const riderRes = await api.riderMe();
  state.rider = riderRes.rider || null;
  state.online = Boolean(state.rider?.is_online);
  await Promise.all([refreshJobs(), refreshEarnings()]);
  state.ready = true;
  bus.emit('ready', state);
  return state;
}

export function signOut() {
  setToken('');
  state.user = null;
  state.ready = false;
  state.rider = null;
  state.jobs = [];
  state.earnings = null;
  state.online = false;
  bus.emit('signout');
}

export function hasSession() { return Boolean(getToken()); }

export const offeredJobs = () => state.jobs.filter(j => j.status === 'offered');
export const activeJobs = () => state.jobs.filter(j => j.status === 'accepted' || j.status === 'picked_up');
export const pastJobs = () => state.jobs.filter(j => j.status === 'delivered');