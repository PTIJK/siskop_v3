// Manual mock for puppeteer — avoids ESM incompatibility in Jest CJS mode.
// PDF generation is tested via integration tests against the real endpoint;
// unit/integration tests that don't call generatePDF don't need a real browser.

const mockPage = {
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock')),
};

const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};

const puppeteer = {
  launch: jest.fn().mockResolvedValue(mockBrowser),
};

module.exports = puppeteer;
module.exports.default = puppeteer;
