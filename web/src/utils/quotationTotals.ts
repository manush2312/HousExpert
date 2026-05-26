export function roundQuotationMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export interface QuotationTotals {
  subtotal: number
  discountAmount: number
  taxableAmount: number
  gstAmount: number
  total: number
}

export function computeQuotationTotals(subtotal: number, discountPercent: number, applyGST: boolean, gstPercent: number): QuotationTotals {
  const safeSubtotal = roundQuotationMoney(subtotal)
  const safeDiscountPercent = Math.min(100, Math.max(0, roundQuotationMoney(discountPercent || 0)))
  const discountAmount = roundQuotationMoney(safeSubtotal * safeDiscountPercent / 100)
  const taxableAmount = roundQuotationMoney(safeSubtotal - discountAmount)
  const safeGSTPercent = applyGST ? Math.max(0, roundQuotationMoney(gstPercent || 0)) : 0
  const gstAmount = applyGST ? roundQuotationMoney(taxableAmount * safeGSTPercent / 100) : 0
  return {
    subtotal: safeSubtotal,
    discountAmount,
    taxableAmount,
    gstAmount,
    total: roundQuotationMoney(taxableAmount + gstAmount),
  }
}
