import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface LoginProps {
  onSignup: () => void;
}

export function Login({ onSignup }: LoginProps) {
  const { loginWithPassword, loginWithToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenMode, setTokenMode] = useState(false);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      if (tokenMode) {
        await loginWithToken(token.trim());
      } else {
        await loginWithPassword(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Secrets Manager</CardTitle>
          <CardDescription>Sign in to your workspace</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!tokenMode ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="token">API or session token</Label>
              <Input
                id="token"
                type="password"
                placeholder="sess_... or sm_..."
                value={token}
                onChange={(e) => setTokenValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button
            onClick={handleSubmit}
            disabled={
              loading ||
              (tokenMode ? !token.trim() : !email.trim() || !password)
            }
          >
            {loading ? 'Checking...' : 'Login'}
          </Button>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTokenMode((v) => !v)}
            >
              {tokenMode ? 'Use email' : 'Use token'}
            </Button>
            <Button type="button" variant="outline" onClick={onSignup}>
              Create account
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
