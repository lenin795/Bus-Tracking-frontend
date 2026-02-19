import axios from "axios";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Required for CORS with credentials
  timeout: 10000, // ✅ NEW: 10 second timeout to prevent hanging requests
});

/* =========================
   REQUEST INTERCEPTOR
========================= */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

    // ✅ Attach token ONLY if present
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => {
    console.error("❌ Request interceptor error:", error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.error(`❌ API Error [${error.response.status}]:`, error.response.data);
    } else if (error.request) {
     
      console.error("❌ Network Error: No response from server", error.message);
    } else {
      console.error("❌ Request Error:", error.message);
    }

    if (
      error.response?.status === 401 &&
      !window.location.pathname.startsWith("/passenger")
    ) {
      console.warn("🔒 Unauthorized - redirecting to login");
      localStorage.removeItem("token");
      window.location.href = "/login";
    }

    return Promise.reject(error);
  }
);

export default api;