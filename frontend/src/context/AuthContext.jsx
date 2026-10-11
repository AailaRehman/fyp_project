import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, tokenStore } from "../utils/api.js";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export const homeFor = (role) => (role === "recruiter" ? "/recruiter" : "/candidate");

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  useEffect(() => {
    if (!tokenStore.get()) return;
    api("/api/auth/me")
      .then((d) => setUser(d.user))
      .catch((e) => { if (e.status === 401) tokenStore.clear(); })
      .finally(() => setLoading(false));
  }, []);

  const finish = useCallback((d) => {
    tokenStore.set(d.token);
    setUser(d.user);
    return d.user;
  }, []);

  const login = useCallback(async (email, password) =>
    finish(await api("/api/auth/login", { method: "POST", body: { email, password } })), [finish]);

  const register = useCallback(async (payload) =>
    finish(await api("/api/auth/register", { method: "POST", body: payload })), [finish]);

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
