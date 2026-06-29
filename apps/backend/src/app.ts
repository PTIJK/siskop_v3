import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { tenantMiddleware } from './middleware/tenant.middleware';
import { authMiddleware } from './middleware/auth.middleware';
import { errorMiddleware } from './middleware/error.middleware';
import { authRouter } from './modules/auth/auth.router';

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files
app.use('/uploads', express.static(process.env.STORAGE_PATH || './uploads'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes — no tenant or auth required
app.use('/api/auth', authRouter);

// Tenant + auth-scoped routes — modules added here as phases are built
// app.use('/api/members', tenantMiddleware, authMiddleware, membersRouter);
// app.use('/api/savings', tenantMiddleware, authMiddleware, savingsRouter);
// app.use('/api/loans', tenantMiddleware, authMiddleware, loansRouter);
// app.use('/api/reports', tenantMiddleware, authMiddleware, reportsRouter);
// app.use('/api/config', tenantMiddleware, authMiddleware, configRouter);

// Suppress unused-import warnings for middleware used above as comments
void tenantMiddleware;
void authMiddleware;

// Global error handler — must be last
app.use(errorMiddleware);

export default app;
