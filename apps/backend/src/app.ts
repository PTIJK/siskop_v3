import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { adminMiddleware } from './middleware/admin.middleware';
import { errorMiddleware } from './middleware/error.middleware';
import { authRouter } from './modules/auth/auth.router';
import { membersRouter } from './modules/members/members.router';
import { savingsRouter } from './modules/savings/savings.router';
import { loansRouter } from './modules/loans/loans.router';
import { dashboardRouter } from './modules/dashboard/dashboard.router';
import { reportsRouter } from './modules/reports/reports.router';
import { configRouter } from './modules/config/config.router';
import { adminRouter } from './modules/admin/admin.router';

const app = express();

// Security
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      const domain = process.env.PLATFORM_DOMAIN || 'localhost';
      if (!origin || origin.includes(domain) || origin.includes('localhost')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Rate limiting (disabled in test mode to prevent interference with test suites)
if (process.env.NODE_ENV !== 'test') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);
}

// Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use('/uploads', express.static(process.env.STORAGE_PATH || './uploads'));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes — no tenant or auth required
app.use('/api/auth', authRouter);

// Platform admin (skip tenantMiddleware, require isPlatformAdmin)
app.use('/api/admin', adminMiddleware, adminRouter);

// Tenant-scoped routes — all require tenantMiddleware + authMiddleware
const tenantRouter = express.Router();
tenantRouter.use('/dashboard', dashboardRouter);
tenantRouter.use('/members', membersRouter);
tenantRouter.use('/savings', savingsRouter);
tenantRouter.use('/loans', loansRouter);
tenantRouter.use('/reports', reportsRouter);
tenantRouter.use('/config', configRouter);

app.use('/api', tenantMiddleware, authMiddleware, tenantRouter);

// Global error handler — must be last
app.use(errorMiddleware);

export default app;
