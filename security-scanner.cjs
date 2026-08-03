#!/usr/bin/env node

/**
 * SISKOP Security Scanner
 *
 * Copy this entire file to your project root as: security-scanner.js
 * Run: node security-scanner.js
 *
 * This script scans your codebase for security controls and generates a detailed report.
 * No dependencies required - uses only Node.js built-ins.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

class SecurityScanner {
  constructor() {
    this.findings = [];
    this.projectRoot = process.cwd();
    this.srcDir = path.join(this.projectRoot, 'src');
    this.report = {
      timestamp: new Date().toISOString(),
      projectRoot: this.projectRoot,
      categories: {},
      overallScore: 0,
      criticalFindings: [],
      highFindings: [],
      mediumFindings: [],
    };
  }

  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  // ============================================================================
  // SECURITY CHECKS
  // ============================================================================

  // 1. Multi-Tenant Isolation Check
  checkMultiTenantIsolation() {
    this.log('\n🔍 Checking Multi-Tenant Isolation...', 'cyan');
    const category = 'Multi-Tenant Isolation';
    const findings = [];
    let score = 0;

    // Check for tenantId in database queries
    const queryFiles = this.findFiles(/\.(ts|tsx|js|jsx)$/, (file) => {
      const content = fs.readFileSync(file, 'utf8');
      return (
        content.includes('prisma.') ||
        content.includes('SELECT') ||
        content.includes('await db.')
      );
    });

    let tenantIdFilteredQueries = 0;
    let totalQueries = 0;

    queryFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');

      // Count SELECT statements
      const selectMatches = content.match(
        /SELECT|prisma\.(member|savings|loan|transaction|user)\.(findMany|findFirst|findUnique|create|update|delete)/g
      );
      if (selectMatches) {
        totalQueries += selectMatches.length;
      }

      // Check for tenantId filters
      if (content.includes('WHERE tenantId') || content.includes('where: { tenantId')) {
        tenantIdFilteredQueries += 1;
      }
    });

    const tenantIdCoverage =
      totalQueries > 0 ? (tenantIdFilteredQueries / totalQueries) * 100 : 0;

    if (tenantIdCoverage >= 90) {
      this.log(`✅ Good coverage: ${tenantIdCoverage.toFixed(1)}% queries filter by tenantId`, 'green');
      score = 90;
    } else if (tenantIdCoverage >= 70) {
      this.log(`⚠️  Partial coverage: ${tenantIdCoverage.toFixed(1)}% queries filter by tenantId`, 'yellow');
      findings.push({
        severity: 'HIGH',
        message: `Only ${tenantIdCoverage.toFixed(1)}% of queries verified to include tenantId filter. Risk of cross-tenant data leak.`,
      });
      score = 60;
    } else {
      this.log(`❌ Low coverage: ${tenantIdCoverage.toFixed(1)}% queries filter by tenantId`, 'red');
      findings.push({
        severity: 'CRITICAL',
        message: `Only ${tenantIdCoverage.toFixed(1)}% of queries include tenantId filter. CRITICAL RISK: Cross-tenant data leakage possible.`,
      });
      score = 20;
    }

    // Check for Prisma middleware enforcement
    const prismaFiles = this.findFiles(
      /prisma\.(ts|js)$/,
      (file) => fs.readFileSync(file, 'utf8').includes('$use')
    );

    if (prismaFiles.length > 0) {
      this.log(`✅ Prisma middleware found for tenantId enforcement`, 'green');
      score = Math.min(score + 10, 100);
    } else {
      findings.push({
        severity: 'HIGH',
        message: 'No Prisma middleware to enforce tenantId filtering. Add middleware to automatically validate all queries.',
      });
    }

    this.report.categories[category] = { score, findings };
    return score;
  }

  // 2. Authentication & Authorization Check
  checkAuthenticationAuthorization() {
    this.log('\n🔍 Checking Authentication & Authorization...', 'cyan');
    const category = 'Authentication & Authorization';
    const findings = [];
    let score = 50;

    // Check for JWT
    const hasJWT =
      this.fileContains(this.srcDir, /jwt|jsonwebtoken/) &&
      this.fileContains(this.srcDir, /sign|verify.*token/);

    if (hasJWT) {
      this.log(`✅ JWT authentication implemented`, 'green');
      score += 20;
    } else {
      findings.push({
        severity: 'CRITICAL',
        message: 'No JWT authentication found. Implement JWT-based auth before launch.',
      });
      score = 20;
    }

    // Check for httpOnly cookies
    const hasHttpOnlyCookies = this.fileContains(
      this.srcDir,
      /httpOnly|secure.*true|sameSite/i
    );

    if (hasHttpOnlyCookies) {
      this.log(`✅ HttpOnly cookies configured`, 'green');
      score += 15;
    } else {
      findings.push({
        severity: 'HIGH',
        message: 'No httpOnly cookie configuration found. Vulnerable to XSS token theft.',
      });
    }

    // Check for password hashing (bcrypt)
    const hasBcrypt = this.fileContains(this.srcDir, /bcrypt|hash.*password/);

    if (hasBcrypt) {
      this.log(`✅ Password hashing (bcrypt) implemented`, 'green');
      score += 15;
    } else {
      findings.push({
        severity: 'CRITICAL',
        message: 'No password hashing found. Passwords must be hashed with bcrypt before storage.',
      });
      score = Math.max(score - 30, 0);
    }

    // Check for MFA
    const hasMFA = this.fileContains(this.srcDir, /mfa|totp|authenticator|2fa/i);

    if (hasMFA) {
      this.log(`✅ MFA implemented`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'MFA not implemented. Recommended for admin/manager roles.',
      });
    }

    // Check for session timeout
    const hasSessionTimeout = this.fileContains(
      this.srcDir,
      /timeout|ttl|expires?In/i
    );

    if (hasSessionTimeout) {
      this.log(`✅ Session timeout configuration found`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'No session timeout configured. Implement 15-min idle timeout.',
      });
    }

    // Check for RBAC
    const hasRBAC = this.fileContains(this.srcDir, /role|permission|rbac|authorize/i);

    if (hasRBAC) {
      this.log(`✅ Role-based access control (RBAC) implemented`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'HIGH',
        message: 'No RBAC found. Implement role-based access control.',
      });
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 3. Secrets Management Check
  checkSecretsManagement() {
    this.log('\n🔍 Checking Secrets Management...', 'cyan');
    const category = 'Secrets Management';
    const findings = [];
    let score = 50;

    // Check for hardcoded secrets
    const secretPatterns = [
      /password\s*[=:]\s*['"][^'"]+['"]/gi,
      /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/gi,
      /secret\s*[=:]\s*['"][^'"]+['"]/gi,
      /database[_-]?url\s*[=:]\s*['"][^'"]+['"]/gi,
      /token\s*[=:]\s*['"][a-zA-Z0-9]{20,}['"]/gi,
    ];

    let hardcodedSecretsFound = 0;
    const sourceFiles = this.findFiles(/\.(ts|tsx|js|jsx)$/);

    sourceFiles.forEach((file) => {
      const content = fs.readFileSync(file, 'utf8');
      secretPatterns.forEach((pattern) => {
        if (pattern.test(content)) {
          hardcodedSecretsFound++;
        }
      });
    });

    if (hardcodedSecretsFound > 0) {
      findings.push({
        severity: 'CRITICAL',
        message: `${hardcodedSecretsFound} potential hardcoded secrets found in source code. Move all secrets to AWS Secrets Manager or environment variables.`,
      });
      this.log(
        `❌ ${hardcodedSecretsFound} hardcoded secrets detected!`,
        'red'
      );
      score = 10;
    } else {
      this.log(`✅ No obvious hardcoded secrets in source code`, 'green');
      score = 60;
    }

    // Check for .env file usage (not ideal, but better than hardcoded)
    const hasEnvFile = fs.existsSync(path.join(this.projectRoot, '.env'));
    const hasEnvUsage = this.fileContains(this.srcDir, /process\.env|dotenv|config/);

    if (hasEnvUsage) {
      if (hasEnvFile) {
        this.log(`⚠️  Using .env file for secrets (not production-grade)`, 'yellow');
        findings.push({
          severity: 'MEDIUM',
          message: '.env file detected. For production, migrate to AWS Secrets Manager or HashiCorp Vault.',
        });
      }
      score += 20;
    }

    // Check for AWS Secrets Manager usage
    const hasSecretsManager =
      this.fileContains(this.srcDir, /SecretsManager|secretsmanager/i) ||
      this.fileContains(this.srcDir, /aws-sdk.*secrets/i);

    if (hasSecretsManager) {
      this.log(`✅ AWS Secrets Manager integration found`, 'green');
      score = 90;
    }

    // Check for .env in gitignore
    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      if (gitignore.includes('.env')) {
        this.log(`✅ .env file is gitignored`, 'green');
        score += 5;
      } else {
        findings.push({
          severity: 'HIGH',
          message: '.env file is NOT in .gitignore. Add .env to .gitignore to prevent accidental commits.',
        });
      }
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 4. Rate Limiting & DDoS Protection Check
  checkRateLimiting() {
    this.log('\n🔍 Checking Rate Limiting & DDoS Protection...', 'cyan');
    const category = 'Rate Limiting & DDoS';
    const findings = [];
    let score = 30;

    // Check for rate limiting middleware
    const hasRateLimit =
      this.fileContains(this.srcDir, /rateLimit|rate-limit|rateLimiter/) ||
      this.fileContains(this.srcDir, /redis\.incr|redis\.expire/);

    if (hasRateLimit) {
      this.log(`✅ Rate limiting middleware found`, 'green');
      score = 70;
    } else {
      findings.push({
        severity: 'HIGH',
        message:
          'No rate limiting found. Implement Redis-based rate limiting to prevent brute force and DDoS attacks.',
      });
    }

    // Check for login attempt limiting
    const hasLoginLimiting =
      this.fileContains(this.srcDir, /login.*limit|auth.*limit/i) &&
      hasRateLimit;

    if (hasLoginLimiting) {
      this.log(`✅ Login rate limiting configured`, 'green');
      score += 15;
    }

    // Check for Cloudflare or WAF integration
    const hasWAF =
      this.fileContains(this.projectRoot, /cloudflare|waf|shield/i) ||
      fs.existsSync(path.join(this.projectRoot, 'cloudflare-waf-rules.json'));

    if (hasWAF) {
      this.log(`✅ WAF/Cloudflare integration found`, 'green');
      score += 15;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'No WAF configuration found. Consider using Cloudflare or AWS WAF for DDoS protection.',
      });
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 5. Encryption Check
  checkEncryption() {
    this.log('\n🔍 Checking Encryption...', 'cyan');
    const category = 'Encryption';
    const findings = [];
    let score = 40;

    // Check for TLS/SSL
    const hasTLS =
      this.fileContains(this.srcDir, /https|tls|ssl|certificate/i) ||
      fs.existsSync(path.join(this.projectRoot, '.env')) ||
      this.fileContains(this.projectRoot, /cert|key/i);

    if (hasTLS) {
      this.log(`✅ TLS/SSL configuration detected`, 'green');
      score = 60;
    } else {
      findings.push({
        severity: 'CRITICAL',
        message: 'TLS/SSL not configured. All data in transit must be encrypted with HTTPS.',
      });
      score = 20;
    }

    // Check for encryption at rest
    const hasEncryption =
      this.fileContains(this.srcDir, /encrypt|crypto|aes/i) ||
      this.fileContains(this.srcDir, /cipher|decrypt/i);

    if (hasEncryption) {
      this.log(`✅ Encryption at rest implementation found`, 'green');
      score += 30;
    } else {
      findings.push({
        severity: 'HIGH',
        message:
          'No field-level encryption for sensitive data (SSN, bank account). Implement AES-256 encryption.',
      });
    }

    // Check for database backup encryption
    const hasBackupEncryption =
      this.fileContains(this.srcDir, /backup.*encrypt|encrypt.*backup/i) ||
      this.fileContains(
        this.projectRoot,
        /backup.*encrypt|encrypt.*backup/i
      );

    if (hasBackupEncryption) {
      this.log(`✅ Backup encryption configured`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'Database backups not encrypted. Implement AES-256 encryption for all backups.',
      });
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 6. Audit Logging Check
  checkAuditLogging() {
    this.log('\n🔍 Checking Audit Logging...', 'cyan');
    const category = 'Audit Logging';
    const findings = [];
    let score = 30;

    // Check for audit log implementation
    const hasAuditLog =
      this.fileContains(this.srcDir, /auditLog|audit_log|AuditLog/) ||
      this.fileContains(this.srcDir, /CREATE TABLE.*audit/i);

    if (hasAuditLog) {
      this.log(`✅ Audit logging implementation found`, 'green');
      score = 70;
    } else {
      findings.push({
        severity: 'CRITICAL',
        message:
          'No audit logging found. Implement immutable audit log for regulatory compliance (OJK requirement).',
      });
    }

    // Check for cryptographic signatures
    const hasSignatures =
      this.fileContains(this.srcDir, /sign|signature|hmac|hash.*audit/i) &&
      hasAuditLog;

    if (hasSignatures) {
      this.log(`✅ Cryptographic signatures for audit logs found`, 'green');
      score += 20;
    } else if (hasAuditLog) {
      findings.push({
        severity: 'HIGH',
        message:
          'Audit logs exist but lack cryptographic signatures. Add HMAC-SHA256 signatures for tamper-proof logs.',
      });
    }

    // Check for transaction logging
    const hasTransactionLog =
      this.fileContains(this.srcDir, /transaction.*log|log.*transaction/i) &&
      hasAuditLog;

    if (hasTransactionLog) {
      this.log(`✅ Transaction logging configured`, 'green');
      score += 10;
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 7. Security Headers Check
  checkSecurityHeaders() {
    this.log('\n🔍 Checking Security Headers...', 'cyan');
    const category = 'Security Headers';
    const findings = [];
    let score = 30;

    // Check for security header middleware
    const hasSecurityHeaders =
      this.fileContains(this.srcDir, /X-Frame-Options|X-Content-Type-Options|CSP|Content-Security-Policy/);

    if (hasSecurityHeaders) {
      this.log(`✅ Security headers middleware found`, 'green');
      score = 70;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message:
          'Security headers not configured. Add middleware for X-Frame-Options, CSP, HSTS, X-Content-Type-Options.',
      });
    }

    // Check for HSTS
    const hasHSTS = this.fileContains(this.srcDir, /Strict-Transport-Security|HSTS/i);
    if (hasHSTS) {
      this.log(`✅ HSTS (HTTP Strict Transport Security) configured`, 'green');
      score += 10;
    }

    // Check for CORS configuration
    const hasCORS = this.fileContains(this.srcDir, /cors|origin|allowedOrigins/i);
    if (hasCORS) {
      this.log(`✅ CORS configuration found`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'CORS configuration not found. Configure explicit origin whitelist (no wildcards).',
      });
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 8. Input Validation Check
  checkInputValidation() {
    this.log('\n🔍 Checking Input Validation...', 'cyan');
    const category = 'Input Validation';
    const findings = [];
    let score = 40;

    // Check for validation library (Joi, Zod, etc.)
    const hasValidation =
      this.fileContains(this.srcDir, /joi|zod|yup|validate/) ||
      this.fileContains(this.srcDir, /schema.*validate|validate.*schema/i);

    if (hasValidation) {
      this.log(`✅ Input validation library detected`, 'green');
      score = 70;
    } else {
      findings.push({
        severity: 'HIGH',
        message: 'No input validation framework found. Implement Joi or Zod for schema validation.',
      });
    }

    // Check for Prisma ORM (prevents SQL injection)
    const hasPrisma =
      this.fileContains(this.srcDir, /prisma|PrismaClient/) ||
      fs.existsSync(path.join(this.projectRoot, 'prisma'));

    if (hasPrisma) {
      this.log(`✅ Prisma ORM detected (parameterized queries)`, 'green');
      score += 15;
    } else {
      findings.push({
        severity: 'HIGH',
        message: 'Prisma ORM not detected. Use parameterized queries to prevent SQL injection.',
      });
      score = Math.max(score - 20, 0);
    }

    // Check for output sanitization
    const hasSanitization =
      this.fileContains(this.srcDir, /sanitize|escape|xss|html-entities/i);

    if (hasSanitization) {
      this.log(`✅ Output sanitization/encoding found`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'Output sanitization not found. Implement XSS prevention for user-generated content.',
      });
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // 9. Dependency Vulnerability Check
  checkDependencyVulnerabilities() {
    this.log('\n🔍 Checking Dependency Vulnerabilities...', 'cyan');
    const category = 'Dependency Security';
    const findings = [];
    let score = 70;

    if (!fs.existsSync(path.join(this.projectRoot, 'package.json'))) {
      this.log(`⚠️  No package.json found`, 'yellow');
      return 50;
    }

    try {
      // This is a pnpm workspace (pnpm-lock.yaml), not npm - `npm audit`
      // errors immediately here with ENOLOCK. pnpm audit exits non-zero
      // when it finds vulnerabilities, but still writes clean JSON to
      // stdout, so pull that from the error object on failure.
      let output;
      try {
        output = execSync('pnpm audit --json', {
          encoding: 'utf8',
          cwd: this.projectRoot,
        });
      } catch (auditError) {
        output = auditError.stdout || '{}';
      }

      const auditData = JSON.parse(output);
      const vulnerabilities = auditData.metadata?.vulnerabilities || {};

      if (vulnerabilities.critical > 0) {
        findings.push({
          severity: 'CRITICAL',
          message: `${vulnerabilities.critical} critical vulnerabilities in dependencies. Run 'npm audit fix' immediately.`,
        });
        this.log(
          `❌ ${vulnerabilities.critical} critical vulnerabilities found!`,
          'red'
        );
        score = 20;
      } else if (vulnerabilities.high > 0) {
        findings.push({
          severity: 'HIGH',
          message: `${vulnerabilities.high} high-severity vulnerabilities in dependencies. Schedule patches.`,
        });
        this.log(`⚠️  ${vulnerabilities.high} high vulnerabilities found`, 'yellow');
        score = 40;
      } else if (vulnerabilities.moderate > 0) {
        findings.push({
          severity: 'MEDIUM',
          message: `${vulnerabilities.moderate} moderate vulnerabilities in dependencies.`,
        });
        this.log(`⚠️  ${vulnerabilities.moderate} moderate vulnerabilities found`, 'yellow');
        score = 80;
      } else {
        this.log(`✅ No known vulnerabilities in dependencies`, 'green');
        score = 95;
      }
    } catch (error) {
      this.log(`⚠️  Could not run npm audit`, 'yellow');
      score = 70;
    }

    this.report.categories[category] = { score, findings };
    return score;
  }

  // 10. Data Residency Check
  checkDataResidency() {
    this.log('\n🔍 Checking Data Residency (Indonesia-only)...', 'cyan');
    const category = 'Data Residency';
    const findings = [];
    let score = 50;

    // Check for AWS region configuration
    const hasRegionConfig =
      this.fileContains(this.projectRoot, /ap-southeast-3|jakarta|indonesia/i) ||
      this.fileContains(this.srcDir, /region.*ap-southeast-3/i);

    if (hasRegionConfig) {
      this.log(`✅ AWS region configured for Indonesia (ap-southeast-3)`, 'green');
      score = 80;
    } else {
      findings.push({
        severity: 'CRITICAL',
        message:
          'No Indonesia data residency configuration found. All databases and backups must be in ap-southeast-3 (Jakarta region) to comply with OJK requirements.',
      });
      score = 20;
    }

    // Check for backup configuration
    const hasBackupConfig =
      this.fileContains(this.projectRoot, /backup|snapshot/i) ||
      this.fileContains(this.srcDir, /backup/i);

    if (hasBackupConfig) {
      this.log(`✅ Backup configuration found`, 'green');
      score += 10;
    } else {
      findings.push({
        severity: 'MEDIUM',
        message: 'Backup strategy not documented. Configure daily backups with retention in Indonesia.',
      });
    }

    // Check for encryption key storage
    const hasKeyManagement =
      this.fileContains(this.srcDir, /key.*store|store.*key/i) ||
      this.fileContains(this.srcDir, /aws.*secretsmanager/i);

    if (hasKeyManagement) {
      this.log(`✅ Encryption key management configured`, 'green');
      score += 10;
    }

    score = Math.min(score, 100);
    this.report.categories[category] = { score, findings };
    return score;
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  findFiles(pattern, filter = null) {
    const files = [];
    const skipDirs = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next']);

    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;

      fs.readdirSync(dir).forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          // Skip node_modules, build output and hidden dirs
          if (!file.startsWith('.') && !skipDirs.has(file)) {
            walk(filePath);
          }
        } else if (pattern.test(file)) {
          if (!filter || filter(filePath)) {
            files.push(filePath);
          }
        }
      });
    };

    // This is a pnpm monorepo (apps/*, packages/*) - there is no top-level
    // src/ dir, so walk the whole project root instead of this.srcDir.
    walk(this.projectRoot);
    return files;
  }

  fileContains(dir, pattern) {
    try {
      const files = this.findFiles(/\.(ts|tsx|js|jsx)$/);
      return files.some((file) => {
        const content = fs.readFileSync(file, 'utf8');
        return pattern.test(content);
      });
    } catch {
      return false;
    }
  }

  // ============================================================================
  // REPORT GENERATION
  // ============================================================================

  generateReport() {
    this.log('\n' + '='.repeat(80), 'cyan');
    this.log('🔐 SISKOP Security Assessment Report', 'bright');
    this.log('='.repeat(80) + '\n', 'cyan');

    const scores = [
      this.checkMultiTenantIsolation(),
      this.checkAuthenticationAuthorization(),
      this.checkSecretsManagement(),
      this.checkRateLimiting(),
      this.checkEncryption(),
      this.checkAuditLogging(),
      this.checkSecurityHeaders(),
      this.checkInputValidation(),
      this.checkDependencyVulnerabilities(),
      this.checkDataResidency(),
    ];

    const overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    this.report.overallScore = overallScore;

    // Reset accumulators - generateReport() runs once for the saved file
    // and once for the console printout, and would otherwise double-count
    // every finding on the second pass.
    this.report.criticalFindings = [];
    this.report.highFindings = [];
    this.report.mediumFindings = [];

    // Collect findings by severity
    Object.values(this.report.categories).forEach((category) => {
      if (category.findings) {
        category.findings.forEach((finding) => {
          if (finding.severity === 'CRITICAL') {
            this.report.criticalFindings.push(finding);
          } else if (finding.severity === 'HIGH') {
            this.report.highFindings.push(finding);
          } else {
            this.report.mediumFindings.push(finding);
          }
        });
      }
    });

    return this.report;
  }

  formatReport() {
    const report = this.generateReport();
    let markdown = `# SISKOP Security Assessment Report

**Generated:** ${report.timestamp}
**Project:** ${report.projectRoot}

---

## 📊 Overall Security Score: ${report.overallScore}/100

`;

    // Score rating
    if (report.overallScore >= 80) {
      markdown += `**Status:** 🟢 GOOD - Most security controls in place\n\n`;
    } else if (report.overallScore >= 60) {
      markdown += `**Status:** 🟡 MODERATE - Several gaps to address before launch\n\n`;
    } else if (report.overallScore >= 40) {
      markdown += `**Status:** 🔴 POOR - Critical security issues must be resolved\n\n`;
    } else {
      markdown += `**Status:** ⛔ CRITICAL - Multiple critical vulnerabilities\n\n`;
    }

    // Category breakdown
    markdown += `## 📋 Security Control Scores\n\n`;
    markdown += `| Category | Score | Status |\n`;
    markdown += `|----------|-------|--------|\n`;

    Object.entries(report.categories).forEach(([category, data]) => {
      const score = data.score;
      let status = '🟢';
      if (score < 50) status = '🔴';
      else if (score < 70) status = '🟡';

      markdown += `| ${category} | ${score}/100 | ${status} |\n`;
    });

    markdown += `\n---\n\n`;

    // Critical findings
    if (report.criticalFindings.length > 0) {
      markdown += `## 🚨 CRITICAL FINDINGS (${report.criticalFindings.length})\n\n`;
      markdown += `**These issues must be resolved before production launch.**\n\n`;
      report.criticalFindings.forEach((finding, i) => {
        markdown += `### ${i + 1}. ${finding.message}\n\n`;
        markdown += `**Severity:** CRITICAL  \n`;
        markdown += `**Timeline:** Immediate (Week 1)\n\n`;
      });
    }

    // High findings
    if (report.highFindings.length > 0) {
      markdown += `## ⚠️ HIGH PRIORITY FINDINGS (${report.highFindings.length})\n\n`;
      markdown += `**These issues should be resolved before launch.**\n\n`;
      report.highFindings.forEach((finding, i) => {
        markdown += `### ${i + 1}. ${finding.message}\n\n`;
        markdown += `**Severity:** HIGH  \n`;
        markdown += `**Timeline:** Within 2 weeks\n\n`;
      });
    }

    // Medium findings
    if (report.mediumFindings.length > 0) {
      markdown += `## ℹ️ MEDIUM PRIORITY FINDINGS (${report.mediumFindings.length})\n\n`;
      markdown += `**These should be addressed post-launch.**\n\n`;
      report.mediumFindings.forEach((finding, i) => {
        markdown += `### ${i + 1}. ${finding.message}\n\n`;
        markdown += `**Severity:** MEDIUM  \n`;
        markdown += `**Timeline:** Within 30 days\n\n`;
      });
    }

    // Detailed breakdown by category
    markdown += `---\n\n## 📑 Detailed Control Assessment\n\n`;

    Object.entries(report.categories).forEach(([category, data]) => {
      markdown += `### ${category}\n\n`;
      markdown += `**Score:** ${data.score}/100\n\n`;

      if (data.findings.length === 0) {
        markdown += `✅ No issues found in this category.\n\n`;
      } else {
        markdown += `**Findings:**\n\n`;
        data.findings.forEach((finding) => {
          markdown += `- **[${finding.severity}]** ${finding.message}\n`;
        });
        markdown += `\n`;
      }
    });

    // Recommendations
    markdown += `---\n\n## 🎯 Next Steps & Recommendations\n\n`;

    markdown += `### Week 1: Immediate Actions\n`;
    markdown += `\`\`\`\n`;
    if (report.criticalFindings.length > 0) {
      markdown += `${report.criticalFindings.length} critical issues require immediate attention:\n`;
      report.criticalFindings.forEach((finding) => {
        markdown += `- ${finding.message.substring(0, 80)}...\n`;
      });
    }
    markdown += `\`\`\`\n\n`;

    markdown += `### Week 2-4: High Priority Fixes\n`;
    markdown += `- Address all ${report.highFindings.length} high-priority findings\n`;
    markdown += `- Implement missing security controls\n`;
    markdown += `- Begin integration testing\n\n`;

    markdown += `### Month 2: Pre-Launch Verification\n`;
    markdown += `- Run external penetration testing\n`;
    markdown += `- Conduct OJK compliance audit\n`;
    markdown += `- Deploy security monitoring (Prometheus, Grafana, ELK)\n`;
    markdown += `- Execute disaster recovery drills\n\n`;

    markdown += `### Ongoing (Post-Launch)\n`;
    markdown += `- Monthly security reviews\n`;
    markdown += `- Quarterly penetration testing\n`;
    markdown += `- Continuous dependency scanning\n`;
    markdown += `- Annual compliance audits\n\n`;

    // Comparison to launch requirements
    markdown += `---\n\n## ✅ Launch Readiness Checklist\n\n`;
    markdown += `Based on SISKOP Security Analysis Plan:\n\n`;

    const launchRequirements = [
      { control: 'Multi-Tenant Isolation', required: 100, current: report.categories['Multi-Tenant Isolation']?.score || 0 },
      { control: 'Authentication & Authorization', required: 90, current: report.categories['Authentication & Authorization']?.score || 0 },
      { control: 'Secrets Management', required: 90, current: report.categories['Secrets Management']?.score || 0 },
      { control: 'Rate Limiting & DDoS', required: 85, current: report.categories['Rate Limiting & DDoS']?.score || 0 },
      { control: 'Encryption', required: 85, current: report.categories['Encryption']?.score || 0 },
      { control: 'Audit Logging', required: 95, current: report.categories['Audit Logging']?.score || 0 },
      { control: 'Security Headers', required: 80, current: report.categories['Security Headers']?.score || 0 },
      { control: 'Input Validation', required: 90, current: report.categories['Input Validation']?.score || 0 },
      { control: 'Dependency Security', required: 90, current: report.categories['Dependency Security']?.score || 0 },
      { control: 'Data Residency', required: 90, current: report.categories['Data Residency']?.score || 0 },
    ];

    let launchReadyCount = 0;
    markdown += `| Control | Required | Current | Status |\n`;
    markdown += `|---------|----------|---------|--------|\n`;

    launchRequirements.forEach((req) => {
      const status = req.current >= req.required ? '✅ READY' : '❌ NOT READY';
      if (req.current >= req.required) launchReadyCount++;
      markdown += `| ${req.control} | ${req.required}/100 | ${req.current}/100 | ${status} |\n`;
    });

    markdown += `\n**Launch Readiness:** ${launchReadyCount}/${launchRequirements.length} controls meet requirements\n\n`;

    if (launchReadyCount === launchRequirements.length) {
      markdown += `🟢 **READY FOR LAUNCH** - All security controls meet minimum requirements\n`;
    } else {
      markdown += `🔴 **NOT READY** - ${launchRequirements.length - launchReadyCount} controls need attention before launch\n`;
    }

    markdown += `\n---\n\n## 📚 Resources\n\n`;
    markdown += `- Full Security Plan: \`SISKOP-SECURITY-ANALYSIS-PLAN.md\`\n`;
    markdown += `- Implementation Guide: \`SISKOP-SECURITY-IMPLEMENTATION-GUIDE.md\`\n`;
    markdown += `- Tracking Dashboard: \`SISKOP-SECURITY-DASHBOARD.md\`\n\n`;

    markdown += `---\n\n**Report Generated by SISKOP Security Scanner**  \nFor questions, contact your CTO or Security Lead.\n`;

    return markdown;
  }

  saveReport() {
    const markdown = this.formatReport();
    const reportPath = path.join(this.projectRoot, 'SECURITY-ASSESSMENT-REPORT.md');

    fs.writeFileSync(reportPath, markdown, 'utf8');
    this.log(`\n✅ Report saved to: ${reportPath}`, 'green');

    return reportPath;
  }

  printReport() {
    const markdown = this.formatReport();
    console.log('\n' + markdown);
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  const scanner = new SecurityScanner();

  try {
    console.log(
      `${colors.blue}${colors.bright}🔍 SISKOP Security Scanner${colors.reset}`
    );
    console.log(`Scanning: ${scanner.projectRoot}\n`);

    // Generate report
    const reportPath = scanner.saveReport();

    // Print summary
    scanner.printReport();

    console.log(
      `\n${colors.green}${colors.bright}✅ Scan complete!${colors.reset}`
    );
    console.log(`Full report saved to: ${colors.cyan}${reportPath}${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.red}Error during scan: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = SecurityScanner;
