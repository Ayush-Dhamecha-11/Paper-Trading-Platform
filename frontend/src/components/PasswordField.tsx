import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: string;
  readonly showPassword: boolean;
  readonly onToggleShow: () => void;
  readonly forgot?: boolean;
  readonly onForgot?: () => void;
};

export default function PasswordField({
  id,
  label,
  placeholder,
  value,
  onChange,
  autoComplete,
  showPassword,
  onToggleShow,
  forgot = false,
  onForgot,
}: Readonly<PasswordFieldProps>) {
  return (
    <div className="field">
      <div className="password-label">
        <label htmlFor={id}>{label}</label>

        {forgot && (
          <button type="button" className="forgot-button" onClick={onForgot}>
            Forgot?
          </button>
        )}
      </div>

      <div className="password-input">
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
        />

        <button
          type="button"
          className="eye-button"
          onClick={onToggleShow}
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <EyeOff size={20} strokeWidth={2} /> : <Eye size={20} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}
