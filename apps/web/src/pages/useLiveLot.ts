import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { applyLotUpdate } from '../api/live';
import type { LotWithAuction } from '../api/types';
import { useApi } from '../auth/context';

/**
 * El lote con su precio al día: consulta inicial + subscription `lotUpdated` (SSE). Las
 * actualizaciones se aplican al instante; ante `ResyncRequired`, un corte del canal o cada 15 s se
 * vuelve a consultar, de modo que el estado definitivo sale siempre de la proyección.
 */
export function useLiveLot(lotId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['lot', lotId],
    queryFn: () => api.getLot(lotId),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const stop = api.subscribeLot(
      lotId,
      (update) => {
        if (update.__typename === 'ResyncRequired') {
          void queryClient.invalidateQueries({ queryKey: ['lot', lotId] });
          void queryClient.invalidateQueries({ queryKey: ['bids', lotId] });
          return;
        }
        const current = queryClient.getQueryData<LotWithAuction | null>(['lot', lotId]);
        if (current) queryClient.setQueryData(['lot', lotId], applyLotUpdate(current, update).lot);
        else void queryClient.invalidateQueries({ queryKey: ['lot', lotId] });
        if (update.__typename === 'BidPlacedUpdate' || update.__typename === 'LotClosedUpdate') {
          void queryClient.invalidateQueries({ queryKey: ['bids', lotId] });
        }
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['lot', lotId] });
      },
    );
    return stop;
  }, [api, lotId, queryClient]);

  return query;
}
