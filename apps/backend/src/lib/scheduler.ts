import cron from 'node-cron';
import { recalculateAllKOL } from './kol';
import prisma from './prisma';

export function startScheduler(): void {
  // KOL recalculation: every day at 00:05 WIB (UTC+7 = 17:05 UTC)
  cron.schedule('5 17 * * *', async () => {
    console.log('[Scheduler] Starting KOL recalculation...');
    try {
      await recalculateAllKOL();
      console.log('[Scheduler] KOL recalculation completed');
    } catch (error) {
      console.error('[Scheduler] KOL recalculation failed:', error);
    }
  });

  // Cleanup expired refresh tokens: every day at 01:00 WIB (18:00 UTC)
  cron.schedule('0 18 * * *', async () => {
    console.log('[Scheduler] Cleaning up expired tokens...');
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      console.log(`[Scheduler] Deleted ${result.count} expired tokens`);
    } catch (error) {
      console.error('[Scheduler] Token cleanup failed:', error);
    }
  });

  console.log('⏰ Scheduler started');
}
