/**
 * Register.jsx
 * Registration form component
 */

import React, { useState } from 'react';
import './Register.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const Register = ({ onSuccess, onBackToLogin }) => {
    const [step, setStep] = useState(1); // 1: Register, 2: Verify Email, 3: Verify Phone
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        phone: ''
    });
    const [userId, setUserId] = useState(null);
    const [verificationToken, setVerificationToken] = useState('');
    const [phoneLastDigits, setPhoneLastDigits] = useState('');
    const [pinCode, setPinCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    // Handle form input changes
    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
        setError('');
    };

    // Step 1: Register
    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Registration failed');
            }

            setUserId(data.user_id);
            setVerificationToken(data.verification_token);
            setMessage(data.message);
            setStep(2); // Move to email verification

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Step 2: Verify Email (Auto-verify for testing)
    const handleVerifyEmail = async () => {
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_URL}/api/auth/verify-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: verificationToken })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Verification failed');
            }

            setPhoneLastDigits(data.phone_last_digits);
            setMessage(data.message);
            setStep(3); // Move to phone verification

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    // Step 3: Verify Phone PIN
    const handleVerifyPhone = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${API_URL}/api/auth/verify-phone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    pin_code: pinCode
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Verification failed');
            }

            // Save token
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('user', JSON.stringify(data.user));

            setMessage(data.message);

            // Call success callback
            setTimeout(() => {
                onSuccess(data);
            }, 1500);

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="register-container">
            <div className="register-card">
                <h2>Create Account</h2>
                <p className="subtitle">Join HRMS</p>

                {/* Step Indicator */}
                <div className="steps-indicator">
                    <div className={`step ${step >= 1 ? 'active' : ''}`}>1. Register</div>
                    <div className={`step ${step >= 2 ? 'active' : ''}`}>2. Verify Email</div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>3. Verify Phone</div>
                </div>

                {/* Messages */}
                {message && <div className="message success">{message}</div>}
                {error && <div className="message error">{error}</div>}

                {/* Step 1: Registration Form */}
                {step === 1 && (
                    <form onSubmit={handleRegister} className="register-form">
                        <div className="form-group">
                            <label>Full Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="John Doe"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="john@example.com"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label>Password</label>
                            <input
                                type="password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                placeholder="Min 8 characters"
                                required
                                minLength={8}
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label>Phone Number</label>
                            <input
                                type="tel"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                placeholder="9876543210"
                                required
                                pattern="[0-9]{10}"
                                disabled={loading}
                            />
                        </div>

                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Creating Account...' : 'Create Account'}
                        </button>

                        <button
                            type="button"
                            className="btn-secondary"
                            onClick={onBackToLogin}
                            disabled={loading}
                        >
                            Back to Login
                        </button>
                    </form>
                )}

                {/* Step 2: Email Verification */}
                {step === 2 && (
                    <div className="verification-step">
                        <div className="icon">📧</div>
                        <p>Email verification link has been generated!</p>
                        <p className="note">In production, check your email. For testing, click below:</p>
                        <button
                            className="btn-primary"
                            onClick={handleVerifyEmail}
                            disabled={loading}
                        >
                            {loading ? 'Verifying...' : 'Verify Email (Auto)'}
                        </button>
                    </div>
                )}

                {/* Step 3: Phone Verification */}
                {step === 3 && (
                    <form onSubmit={handleVerifyPhone} className="verification-step">
                        <div className="icon">📱</div>
                        <p>Enter the 6-digit PIN sent to ****{phoneLastDigits}</p>

                        <div className="form-group">
                            <input
                                type="text"
                                value={pinCode}
                                onChange={(e) => setPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder="000000"
                                maxLength={6}
                                className="pin-input"
                                required
                                autoFocus
                                disabled={loading}
                            />
                        </div>

                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={loading || pinCode.length !== 6}
                        >
                            {loading ? 'Verifying...' : 'Verify & Login'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default Register;
