import React, { useState } from 'react';
import axios from 'axios';

const ConnectionTest = () => {
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const testConnection = async () => {
    setLoading(true);
    setResult('Testing...');
    
    try {
      // Test 1: Check if backend is reachable
      const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/auth/me`);
      setResult('❌ Backend responded but expected error (this is good!):\n' + JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        // Backend is reachable and responded
        setResult('✅ Backend is connected!\nStatus: ' + error.response.status + '\nMessage: ' + JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        // Request made but no response
        setResult('❌ Backend not responding. Make sure backend is running on port 5000.\nError: ' + error.message);
      } else {
        setResult('❌ Error: ' + error.message);
      }
    }
    setLoading(false);
  };

  const testRegister = async () => {
    setLoading(true);
    setResult('Testing registration...');
    
    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
      
      const response = await axios.post(`${API_URL}/auth/register`, {
        name: 'Test User',
        email: 'test' + Date.now() + '@bus.com',
        password: 'test123',
        role: 'driver',
        phone: '1234567890'
      });
      
      setResult('✅ Registration works!\n' + JSON.stringify(response.data, null, 2));
    } catch (error) {
      if (error.response) {
        setResult('❌ Registration failed:\nStatus: ' + error.response.status + '\nError: ' + JSON.stringify(error.response.data, null, 2));
      } else if (error.request) {
        setResult('❌ Cannot reach backend:\n' + error.message);
      } else {
        setResult('❌ Error: ' + error.message);
      }
    }
    setLoading(false);
  };

  const checkEnv = () => {
    const apiUrl = process.env.REACT_APP_API_URL || 'Not set (using default)';
    const socketUrl = process.env.REACT_APP_SOCKET_URL || 'Not set (using default)';
    
    setResult(
      'Environment Variables:\n' +
      'REACT_APP_API_URL: ' + apiUrl + '\n' +
      'REACT_APP_SOCKET_URL: ' + socketUrl + '\n\n' +
      'Default URLs:\n' +
      'API: http://localhost:5000/api\n' +
      'Socket: http://localhost:5000'
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-6">🔧 Backend Connection Test</h1>
          
          <div className="space-y-4 mb-6">
            <button
              onClick={testConnection}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50"
            >
              Test 1: Check Backend Connection
            </button>
            
            <button
              onClick={testRegister}
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50"
            >
              Test 2: Test Registration API
            </button>
            
            <button
              onClick={checkEnv}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg"
            >
              Test 3: Check Environment Variables
            </button>
          </div>

          {loading && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            </div>
          )}

          {result && (
            <div className="bg-gray-900 text-green-400 p-6 rounded-lg font-mono text-sm whitespace-pre-wrap">
              {result}
            </div>
          )}

          <div className="mt-8 p-6 bg-blue-50 rounded-lg">
            <h2 className="font-bold text-lg mb-3">📋 Checklist:</h2>
            <ul className="space-y-2 text-gray-700">
              <li>✓ Backend running on http://localhost:5000</li>
              <li>✓ Frontend running on http://localhost:3000</li>
              <li>✓ MongoDB connected</li>
              <li>✓ .env files configured</li>
            </ul>
          </div>

          <div className="mt-6 text-center">
            <a href="/" className="text-blue-600 hover:text-blue-800 font-semibold">
              ← Back to Home
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionTest;