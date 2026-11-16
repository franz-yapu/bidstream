import { describeError } from './errors';

export function ErrorNote({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  return (
    <p role="alert" className="error">
      {describeError(error)}
    </p>
  );
}
