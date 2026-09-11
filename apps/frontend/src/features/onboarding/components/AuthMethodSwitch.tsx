import type { AuthMethod } from "../firebase";

export function AuthMethodSwitch({ value, onChange, disabled = false }: {
  value: AuthMethod; onChange: (value: AuthMethod) => void; disabled?: boolean;
}) {
  return (
    <fieldset className='auth-method-switch' disabled={disabled}>
      <legend>Metode masuk</legend>
      <div className='auth-method-options'>
        {([['password', 'Email & kata sandi'], ['google', 'Google']] as const).map(([method, label]) => (
          <label key={method} data-selected={value === method}>
            <input type='radio' name='authMethod' value={method} checked={value === method}
              onChange={() => onChange(method)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
