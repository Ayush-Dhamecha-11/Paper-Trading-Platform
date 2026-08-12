import AuthPage from "./AuthPage";

type LoginPageProps = {
  onAuthSuccess?: () => void;
};

export default function LoginPage({ onAuthSuccess }: LoginPageProps) {
  return <AuthPage initialMode="login" onAuthSuccess={onAuthSuccess} />;
}