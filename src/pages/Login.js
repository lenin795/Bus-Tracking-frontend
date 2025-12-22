import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Bus, AlertCircle } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('driver');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password, role);
      navigate(`/${role}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 via-purple-600 to-pink-500 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full mb-4 shadow-lg">
            <Bus className="text-white" size={40} />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Bus Tracker</h1>
          <p className="text-gray-600">Admin & Driver Portal</p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-lg mb-6 flex items-start">
            <AlertCircle className="mr-2 flex-shrink-0 mt-0.5" size={20} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Login As
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            >
              <option value="driver">Driver</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Email Address
            </label>
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
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Password
            </label>
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

        <div className="mt-8 text-center">
          <div className="inline-block bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border-2 border-blue-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">Demo Credentials:</p>
            <div className="space-y-2 text-sm">
              <div className="bg-white rounded-lg p-2">
                <p className="font-semibold text-blue-600">Admin</p>
                <p className="text-gray-600">admin@bus.com / admin123</p>
              </div>
              <div className="bg-white rounded-lg p-2">
                <p className="font-semibold text-green-600">Driver</p>
                <p className="text-gray-600">driver@bus.com / driver123</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link 
            to="/track" 
            className="text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-2"
          >
            <Bus size={20} />
            Track Your Bus (No Login Required) →
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Login;