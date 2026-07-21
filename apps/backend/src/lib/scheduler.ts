import cron from 'node-cron';
import { recalculateAllKOL } from './kol';
import { processBillingReminders } from './billing';
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

  // Billing reminders + auto-block: every day at 00:10 WIB (17:10 UTC)
  cron.schedule('10 17 * * *', async () => {
    console.log('[Scheduler] Processing billing reminders...');
    try {
      await processBillingReminders();
      console.log('[Scheduler] Billing reminders processed');
    } catch (error) {
      console.error('[Scheduler] Billing reminders failed:', error);
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
