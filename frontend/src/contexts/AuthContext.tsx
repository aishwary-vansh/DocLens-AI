// src/contexts/AuthContext.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Manages JWT token, user profile, and exposes login / logout helpers.
// Wraps the whole app so any component can call useAuth().
// ─────────────────────────────────────────────────────────────────────────────
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { authApi, tokenStorage, UserProfile, ApiError } from '../services/api';

interface AuthState {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;      // true while validating stored token on mount
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  updateUser: (user: UserProfile) => void;
  logout: () => void;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: tokenStorage.get(),
    isLoading: true,
    isAuthenticated: false,
  });
  const [error, setError] = useState<string | null>(null);

  // ── On mount: validate stored token ────────────────────────────────────
  useEffect(() => {
    const storedToken = tokenStorage.get();
    if (!storedToken) {
      setState((s) => ({ ...s, isLoading: false }));
      return;
    }
    authApi
      .me()
      .then((user) =>
        setState({ user, token: storedToken, isLoading: false, isAuthenticated: true }),
      )
      .catch(() => {
        tokenStorage.clear();
        setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
      });
  }, []);

  // ── Login ───────────────────────────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { accessToken, user } = await authApi.login(email, password);
      tokenStorage.set(accessToken);
      setState({ user, token: accessToken, isLoading: false, isAuthenticated: true });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Login failed';
      setError(msg);
      throw e;
    }
  }, []);

  // ── Register ────────────────────────────────────────────────────────────
  const register = useCallback(
    async (email: string, password: string, name: string) => {
      setError(null);
      try {
        const { accessToken, user } = await authApi.register(email, password, name);
        tokenStorage.set(accessToken);
        setState({ user, token: accessToken, isLoading: false, isAuthenticated: true });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Registration failed';
        setError(msg);
        throw e;
      }
    },
    [],
  );

  // ── Google sign-in ──────────────────────────────────────────────────────
  const loginWithGoogle = useCallback(async (credential: string) => {
    setError(null);
    try {
      const { accessToken, user } = await authApi.google(credential);
      tokenStorage.set(accessToken);
      setState({ user, token: accessToken, isLoading: false, isAuthenticated: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Google sign-in failed');
      throw e;
    }
  }, []);

  // ── Profile edits (Settings) ────────────────────────────────────────────
  const updateUser = useCallback((user: UserProfile) => {
    setState((s) => ({ ...s, user }));
  }, []);

  // ── Logout ──────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    tokenStorage.clear();
    setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        register,
        loginWithGoogle,
        updateUser,
        logout,
        error,
        clearError: () => setError(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
