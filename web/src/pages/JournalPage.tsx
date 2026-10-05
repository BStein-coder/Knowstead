import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/client';
import { ErrorView, Loading } from '../components/ui';

/** Öffnet (bzw. erzeugt) die heutige Tagesnotiz im persönlichen Bereich. */
export default function JournalPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .post<{ url: string }>('/api/v1/journal/today', {})
      .then((res) => navigate(res.url, { replace: true }))
      .catch(setError);
  }, [navigate]);
  if (error) return <div className="container"><ErrorView error={error} /></div>;
  return <Loading />;
}
