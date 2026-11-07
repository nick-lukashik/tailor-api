/**
 * A one-page PDF with a few lines of Helvetica, built in memory: the mock
 * behind `cv.<domain>/demo` until the real CV files arrive with the pipeline.
 */
export function buildDemoPdf(lines: readonly string[]): Buffer {
    const pdfText = (text: string) => text.replace(/[\\()]/g, char => `\\${char}`)
    const stream = [
        'BT',
        '/F1 20 Tf',
        '72 760 Td',
        ...lines.flatMap((line, i) => [
            ...(i === 0
                ? []
                : [
                      '0 -28 Td',
                  ]),
            `(${pdfText(line)}) Tj`,
        ]),
        'ET',
    ].join('\n')
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    ]
    let body = '%PDF-1.4\n'
    const offsets: number[] = []
    objects.forEach((object, i) => {
        offsets.push(Buffer.byteLength(body, 'latin1'))
        body += `${i + 1} 0 obj\n${object}\nendobj\n`
    })
    const xref = Buffer.byteLength(body, 'latin1')
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(body, 'latin1')
}
