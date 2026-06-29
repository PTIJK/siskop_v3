import 'dotenv/config';
import app from './app';
import { startScheduler } from './lib/scheduler';

const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  console.log(`🚀 SISKOP Backend running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Platform domain: ${process.env.PLATFORM_DOMAIN}`);
});

startScheduler();
