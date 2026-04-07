import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bus, AlertCircle, X } from 'lucide-react';

const TEST_CREDENTIALS = [
  {
    role: 'Admin',
    email: 'Admin@gmail.com',
    password: 'admin@123',
    badgeColor: 'bg-blue-100 text-blue-800',
  },
  {
    role: 'Driver',
    email: 'driver@gmail.com',
    password: 'driver123',
    badgeColor: 'bg-green-100 text-green-800',
  },
];

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPopup, setShowPopup] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await login(email, password);
      if (response.user.role === 'admin') navigate('/admin');
      else if (response.user.role === 'driver') navigate('/driver');
      else if (response.user.role === 'student' || response.user.role === 'passenger') navigate('/passenger');
      else navigate('/');
    } catch (err) {
      console.error('Login error:', err);
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (cred) => {
    setEmail(cred.email);
    setPassword(cred.password);
    setShowPopup(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 flex items-center justify-center p-4">

      {/* ✅ Popup Modal Overlay */}
      {showPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowPopup(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popup Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-800">Test Credentials</h2>
              <button
                onClick={() => setShowPopup(false)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Click any account below to auto-fill the login form.
            </p>

            {/* Credential Cards */}
            <div className="space-y-3">
              {TEST_CREDENTIALS.map((cred) => (
                <button
                  key={cred.role}
                  type="button"
                  onClick={() => fillCredentials(cred)}
                  className="w-full text-left border-2 border-gray-100 hover:border-blue-400 hover:bg-blue-50 rounded-xl px-4 py-3 transition group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${cred.badgeColor}`}>
                      {cred.role}
                    </span>
                    <span className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 transition font-medium">
                      Click to fill →
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400 w-20 text-xs">Email</span>
                      <span className="font-mono text-gray-700">{cred.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400 w-20 text-xs">Password</span>
                      <span className="font-mono text-gray-700">{cred.password}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <p className="text-xs text-gray-400 text-center mt-5">
              For testing purposes only
            </p>
          </div>
        </div>
      )}

      {/* Login Card */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-4 shadow-lg">
            <Bus className="text-white" size={40} />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Bus Tracker</h1>
          <p className="text-gray-600">Admin & Driver Portal</p>
        </div>

        {/* ✅ Test Credentials Trigger */}
        <div className="mb-6 text-center">
          <button
            type="button"
            onClick={() => setShowPopup(true)}
            className="text-sm text-blue-600 hover:text-blue-800 underline underline-offset-2 transition font-medium"
          >
            View test credentials
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start">
            <AlertCircle className="mr-2 flex-shrink-0 mt-0.5" size={20} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="Enter your email"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-4 px-4 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transform hover:scale-[1.02]"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-gray-600">
            Don't have an account?{' '}
            <Link to="/register" className="text-blue-600 hover:text-blue-800 font-bold">
              Create Account
            </Link>
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link to="/track" className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-2">
            <Bus size={20} />
            Track Your Bus (No Login Required) →
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;