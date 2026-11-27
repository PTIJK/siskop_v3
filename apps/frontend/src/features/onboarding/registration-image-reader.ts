import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import workerPath from "tesseract.js/dist/worker.min.js?url";
import corePath from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import languagePath from "@tesseract.js-data/ind/4.0.0_best_int/ind.traineddata.gz?url";
import { readCooperativeCertificate, readRegistrationFields } from "./document-autofill";

export type RegistrationPhotoProgress = {
  stage: "preparing" | "reading" | "checking_table" | "retrying" | "extracting";
  percent?: number;
};

export async function readRegistrationPhoto(file: File, kind: Parameters<typeof readRegistrationFields>[0], {
  signal, onProgress
}: { signal: AbortSignal; onProgress: (progress: RegistrationPhotoProgress) => void }) {
  signal.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas unavailable");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  signal.throwIfAborted();
  const langPath = new URL(".", new URL(languagePath, window.location.href)).href;
  let stage: RegistrationPhotoProgress["stage"] = "preparing";
  const worker = await new Promise<Worker>((resolve, reject) => {
    void createWorker("ind", OEM.LSTM_ONLY, {
      workerPath, corePath, langPath, workerBlobURL: false, cacheMethod: "none", errorHandler: reject,
      logger: ({ status, progress }) => {
        if (!signal.aborted && status === "recognizing text" && Number.isFinite(progress)) {
          onProgress({ stage, percent: Math.round(Math.max(0, Math.min(1, progress)) * 100) });
        }
      }
    }).then(resolve, reject);
  });
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); });
  signal.addEventListener("abort", abort, { once: true });
  const recognize = async (image: HTMLCanvasElement, next: RegistrationPhotoProgress["stage"]) => {
    signal.throwIfAborted();
    stage = next;
    onProgress({ stage, percent: 0 });
    return (await Promise.race([worker.recognize(image), stopped])).data.text;
  };
  try {
    signal.throwIfAborted();
    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK }), stopped]);
    const first = await recognize(canvas, "reading");
    if (kind === "cooperative" && /nomor\s+induk\s+koperasi/i.test(first)) {
      // The certificate's center table excludes decorative borders, seals and the QR code.
      const table = document.createElement("canvas");
      const left = Math.round(canvas.width * 0.19);
      const top = Math.round(canvas.height * 0.29);
      const width = Math.round(canvas.width * 0.75);
      const height = Math.round(canvas.height * 0.31);
      table.width = width * 2;
      table.height = height * 2;
      const context = table.getContext("2d");
      if (context) {
        context.filter = "grayscale(1) contrast(1.5)";
        context.drawImage(canvas, left, top, width, height, 0, 0, table.width, table.height);
        const rows = await recognize(table, "checking_table");
        onProgress({ stage: "extracting" });
        const fields = readCooperativeCertificate(rows);
        if (Object.values(fields).some(Boolean)) return { fields, recognizedText: rows.trim() };
      }
    }
    onProgress({ stage: "extracting" });
    const fields = readRegistrationFields(kind, first);
    if (Object.values(fields).every(Boolean)) return { fields, recognizedText: "" };

    await Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }), stopped]);
    const retry = await recognize(canvas, "retrying");
    onProgress({ stage: "extracting" });
    return { fields: readRegistrationFields(kind, first, retry), recognizedText: first.trim() || retry.trim() };
  } finally {
    signal.removeEventListener("abort", abort);
    await worker.terminate();
  }
}
