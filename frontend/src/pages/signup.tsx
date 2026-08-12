import AuthPage from "./AuthPage";

type SignupPageProps = {
  onAuthSuccess?: () => void;
};

export default function SignupPage({ onAuthSuccess }: SignupPageProps) {
  return <AuthPage initialMode="signup" onAuthSuccess={onAuthSuccess} />;
}
