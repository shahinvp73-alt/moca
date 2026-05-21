import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);

  useEffect(() => {
    if (step !== 2 || otpSecondsLeft <= 0) return;

    const timer = setTimeout(() => {
      setOtpSecondsLeft((seconds) => Math.max(seconds - 1, 0));
    }, 1000);

    return () => clearTimeout(timer);
  }, [step, otpSecondsLeft]);

  const readApiMessage = async (response, fallback) => {
    try {
      const data = await response.json();
      return data.error || data.message || fallback;
    } catch (err) {
      return fallback;
    }
  };

  const handleRequestOTP = async (e) => {
    e?.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        import.meta.env.VITE_API_URL + "/password-reset/request-otp/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), email: email.trim().toLowerCase() }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        setOtp("");
        setOtpSecondsLeft(60);
        setMessage(data.message);
        setStep(2);
      } else {
        const apiMessage = await readApiMessage(
          response,
          response.status === 400
            ? "Enter the username and registered email for your account."
            : "The email service is not available. Please try again later."
        );
        setError(apiMessage);
      }
    } catch (err) {
      setError("Server error. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();

    if (otpSecondsLeft <= 0) {
      setOtp("");
      setError("OTP expired. Please resend OTP.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        import.meta.env.VITE_API_URL + "/password-reset/verify-otp/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        setMessage(data.message);
        setOtpSecondsLeft(0);
        setStep(3);
      } else {
        const apiMessage = await readApiMessage(
          response,
          "Invalid OTP. Please resend OTP."
        );
        setOtpSecondsLeft(0);
        setOtp("");
        setError(apiMessage);
      }
    } catch (err) {
      setError("Server error. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        import.meta.env.VITE_API_URL + "/password-reset/reset-password/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim(), password }),
        }
      );
      if (response.ok) {
        alert("Password reset successful! Redirecting to login...");
        navigate("/login");
      } else {
        const apiMessage = await readApiMessage(
          response,
          "Failed to reset password"
        );
        setError(apiMessage);
      }
    } catch (err) {
      setError("Server error. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>Reset Password</h2>
        <p style={styles.subtitle}>
          {step === 1 && "Enter your username and registered email to receive an OTP"}
          {step === 2 && "Enter the 6-digit OTP sent to your email"}
          {step === 3 && "Create a new strong password"}
        </p>

        {step === 1 && (
          <form onSubmit={handleRequestOTP} style={styles.form}>
            <input
              style={styles.input}
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              style={styles.input}
              type="email"
              placeholder="Registered Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button type="submit" disabled={loading} style={loading ? styles.buttonDisabled : styles.button}>
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleVerifyOTP} style={styles.form}>
            <p style={otpSecondsLeft > 0 ? styles.timer : styles.timerExpired}>
              {otpSecondsLeft > 0 ? `OTP expires in ${otpSecondsLeft}s` : "OTP expired"}
            </p>
            <input
              style={styles.input}
              type="text"
              placeholder="6-digit OTP"
              maxLength="6"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              required
              disabled={otpSecondsLeft <= 0}
            />
            <button type="submit" disabled={loading || otpSecondsLeft <= 0} style={loading || otpSecondsLeft <= 0 ? styles.buttonDisabled : styles.button}>
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
            <button type="button" disabled={loading} onClick={handleRequestOTP} style={styles.resendButton}>
              Resend OTP
            </button>
            <button type="button" onClick={() => setStep(1)} style={styles.backButton}>
              Back
            </button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={handleResetPassword} style={styles.form}>
            <input
              style={styles.input}
              type="password"
              placeholder="New Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <input
              style={styles.input}
              type="password"
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            <button type="submit" disabled={loading} style={loading ? styles.buttonDisabled : styles.button}>
              {loading ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}

        {error && <p style={styles.error}>{error}</p>}
        {message && <p style={styles.success}>{message}</p>}

        <p style={styles.footerText}>
          Remembered your password?{" "}
          <Link to="/login" style={styles.link}>Login</Link>
        </p>
      </div>
    </div>
  );
};

const styles = {
  page: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(135deg, #43cea2, #185a9d)",
    fontFamily: "Arial, sans-serif",
  },
  card: {
    width: "360px",
    padding: "35px",
    borderRadius: "16px",
    background: "#ffffff",
    textAlign: "center",
    boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
  },
  title: {
    fontSize: "28px",
    marginBottom: "8px",
    color: "#333",
    fontWeight: "bold",
  },
  subtitle: {
    marginBottom: "25px",
    color: "#666",
    fontSize: "14px",
    lineHeight: "1.5",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  input: {
    padding: "12px",
    borderRadius: "8px",
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #ccc",
    fontSize: "15px",
    outline: "none",
  },
  button: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    color: "white",
    cursor: "pointer",
    background: "linear-gradient(135deg, #667eea, #764ba2)",
    fontSize: "16px",
    fontWeight: "bold",
  },
  buttonDisabled: {
    padding: "12px",
    borderRadius: "8px",
    border: "none",
    color: "white",
    cursor: "not-allowed",
    background: "linear-gradient(135deg, #667eea, #764ba2)",
    fontSize: "16px",
    fontWeight: "bold",
    opacity: 0.7,
  },
  backButton: {
    background: "none",
    border: "none",
    color: "#666",
    cursor: "pointer",
    fontSize: "14px",
    textDecoration: "underline",
  },
  resendButton: {
    background: "none",
    border: "none",
    color: "#667eea",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "bold",
  },
  error: {
    color: "red",
    marginTop: "12px",
    fontSize: "14px",
  },
  success: {
    color: "green",
    marginTop: "12px",
    fontSize: "14px",
  },
  timer: {
    color: "#185a9d",
    margin: "0",
    fontSize: "14px",
    fontWeight: "bold",
  },
  timerExpired: {
    color: "red",
    margin: "0",
    fontSize: "14px",
    fontWeight: "bold",
  },
  footerText: {
    marginTop: "18px",
    fontSize: "14px",
    color: "#555",
  },
  link: {
    color: "#667eea",
    textDecoration: "none",
    fontWeight: "bold",
  },
};

export default ForgotPassword;
