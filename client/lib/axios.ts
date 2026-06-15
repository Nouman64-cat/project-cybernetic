import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// Singleton Axios instance — import `api` everywhere instead of constructing
// a new axios() per call.  baseURL resolves at build time from the env var,
// so swapping environments (dev / staging / prod) is a single .env change.
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:7005',
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
});

// Request interceptor — attach auth headers here when auth is added
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => config,
  (error: AxiosError) => Promise.reject(error),
);

// Response interceptor — normalise error shapes for the UI layer
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError<{ detail?: string }>) => {
    const message =
      error.response?.data?.detail ??
      error.message ??
      'An unexpected error occurred.';
    return Promise.reject(new Error(message));
  },
);

export default api;
