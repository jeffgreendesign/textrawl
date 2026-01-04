import type { ToolSchema } from './schemas';

interface ParameterFormProps {
  schema: ToolSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
}

export function ParameterForm({ schema, values, onChange }: ParameterFormProps) {
  const handleChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="parameter-form">
      <label className="form-title">Parameters</label>

      {schema.parameters.map((param) => (
        <div key={param.name} className="param-field">
          <label>
            <span className="param-name">{param.name}</span>
            {param.required && <span className="required">*</span>}
          </label>
          <span className="param-desc">{param.description}</span>

          {param.type === 'string' && (
            <input
              type="text"
              value={(values[param.name] as string) || ''}
              onChange={(e) => handleChange(param.name, e.target.value)}
              placeholder={param.description}
            />
          )}

          {param.type === 'number' && (
            <input
              type="number"
              value={(values[param.name] as number) ?? param.default ?? ''}
              onChange={(e) => handleChange(param.name, parseFloat(e.target.value) || undefined)}
              min={param.min}
              max={param.max}
              step={param.max && param.max <= 2 ? 0.1 : 1}
            />
          )}

          {param.type === 'boolean' && (
            <select
              value={String(values[param.name] ?? param.default ?? false)}
              onChange={(e) => handleChange(param.name, e.target.value === 'true')}
            >
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          )}

          {param.type === 'enum' && param.options && (
            <select
              value={(values[param.name] as string) || ''}
              onChange={(e) => handleChange(param.name, e.target.value || undefined)}
            >
              <option value="">-- Select --</option>
              {param.options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
        </div>
      ))}

      <style>{`
        .parameter-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .form-title {
          font-weight: 500;
          color: var(--sl-color-text);
        }

        .param-field {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .param-field label {
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .param-name {
          font-family: monospace;
          font-size: 0.9rem;
          color: var(--sl-color-text);
        }

        .required {
          color: #ef4444;
        }

        .param-desc {
          font-size: 0.8rem;
          color: var(--sl-color-text);
          opacity: 0.6;
        }

        .param-field input,
        .param-field select {
          padding: 0.5rem;
          border: 1px solid var(--sl-color-hairline);
          border-radius: 4px;
          background: var(--sl-color-bg);
          color: var(--sl-color-text);
          font-family: inherit;
        }

        .param-field input:focus,
        .param-field select:focus {
          outline: none;
          border-color: var(--sl-color-accent);
        }
      `}</style>
    </div>
  );
}
