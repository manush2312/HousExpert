export function roundQuotationMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export interface QuotationTotals {
  subtotal: number
  gstAmount: number
  total: number
}

export function computeQuotationTotals(subtotal: number, applyGST: boolean, gstPercent: number): QuotationTotals {
  const safeSubtotal = roundQuotationMoney(subtotal)
  const safeGSTPercent = applyGST ? Math.max(0, roundQuotationMoney(gstPercent || 0)) : 0
  const gstAmount = applyGST ? roundQuotationMoney(safeSubtotal * safeGSTPercent / 100) : 0
  return {
    subtotal: safeSubtotal,
    gstAmount,
    total: roundQuotationMoney(safeSubtotal + gstAmount),
  }
}
