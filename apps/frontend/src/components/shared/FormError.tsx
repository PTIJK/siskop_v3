import { AlertCircle } from 'lucide-react';

interface FormErrorProps {
  error?: string | string[];
}

export function FormError({ error }: FormErrorProps) {
  if (!error) return null;
  const messages = Array.isArray(error) ? error : [error];
  return (
    <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        {messages.map((msg, i) => (
          <p key={i}>{msg}</p>
        ))}
      </div>
    </div>
  );
}
