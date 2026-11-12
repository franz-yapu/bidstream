import type { PrismaClient } from '../generated/client.js';

/**
 * Borra la proyección (`bid`, `lot`, `auction`) y los registros de `processed_event` del consumidor
 * indicado (por defecto `projector`), en una sola transacción. Es el primer paso del reproceso
 * (spec §5): después se reposiciona el grupo a `earliest` y se reconstruye desde el log. Sin borrar
 * también `processed_event`, todos los eventos se tomarían por ya procesados. Los registros de otros
 * consumidores (`notifier`, `auditor`) no se tocan.
 *
 * Es una función de librería, nunca una ruta HTTP: solo debe usarla una herramienta explícita.
 */
export async function resetProjection(
  prisma: Pick<PrismaClient, '$transaction'>,
  consumer = 'projector',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.bid.deleteMany();
    await tx.lot.deleteMany();
    await tx.auction.deleteMany();
    await tx.processedEvent.deleteMany({ where: { consumer } });
  });
}
