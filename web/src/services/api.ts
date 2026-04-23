import axios from 'axios'

// All API requests go to /api — Vite proxies this to http://localhost:8080 in dev.
// In production, set VITE_API_BASE in .env.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request (populated once auth is built)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export default api
