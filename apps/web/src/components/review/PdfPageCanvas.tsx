import { GlobalWorkerOptions, getDocument, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

// The worker is a bundled same-origin asset (`?url`): CSP is `'self'` everywhere, so no blob:
// or data: URLs. pdf.js 6 has no eval path at all (the old `isEvalSupported: false` guard is
// gone from its API), so nothing here needs `unsafe-eval`.
GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfPageCanvasProps {
  readonly batchId: string;
  readonly page: number;
}

/**
 * One page of a stored statement PDF, rendered client-side: the bytes come from the
 * batch-scoped file route (the only way a PDF is read, AD-21) and land on a canvas.
 */
export function PdfPageCanvas({ batchId, page }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<Awaited<ReturnType<typeof getDocument>["promise"]> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    void (async () => {
      try {
        let doc = docRef.current;
        if (doc === null) {
          const res = await fetch(`/api/import/pdf/${encodeURIComponent(batchId)}/file`);
          if (!res.ok) {
            throw new Error(
              res.status === 404
                ? "That statement file is no longer there."
                : "Could not read the statement file.",
            );
          }
          const data = new Uint8Array(await res.arrayBuffer());
          const loadingTask = getDocument({ data, useSystemFonts: true });
          doc = await loadingTask.promise;
          if (cancelled) {
            await loadingTask.destroy();
            return;
          }
          docRef.current = doc;
        }
        if (page < 1 || page > doc.numPages) {
          if (!cancelled) setProblem(`This statement has no page ${page}.`);
          return;
        }
        const pdfPage = await doc.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (canvas === null || context === null || cancelled) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = pdfPage.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
        if (!cancelled) setProblem(null);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "RenderingCancelledException"))
          return;
        setProblem(err instanceof Error ? err.message : "Could not render the statement page.");
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [batchId, page]);

  useEffect(
    () => () => {
      const doc = docRef.current;
      docRef.current = null;
      void doc?.loadingTask.destroy();
    },
    [],
  );

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Statement page ${page}`}
        className="max-h-[70vh] w-full rounded-md border border-border bg-white"
      />
      {problem === null ? null : (
        <p role="alert" className="m-0 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
