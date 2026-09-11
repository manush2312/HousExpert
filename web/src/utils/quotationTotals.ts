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

export type QuotationDiscountMode = 'percent' | 'amount'

/**
 * A flat discount is capped at the subtotal so the total can never go negative.
 * Anything other than 'amount' is treated as percent, which keeps quotations
 * saved before this option existed behaving exactly as they did.
 */
export function resolveQuotationDiscount(
  subtotal: number,
  discountPercent: number,
  discountMode: QuotationDiscountMode = 'percent',
  discountValue = 0,
): number {
  if (discountMode === 'amount') {
    const value = Math.max(0, roundQuotationMoney(discountValue || 0))
    return roundQuotationMoney(Math.min(value, subtotal))
  }
  const safePercent = Math.min(100, Math.max(0, roundQuotationMoney(discountPercent || 0)))
  return roundQuotationMoney(subtotal * safePercent / 100)
}

// The two trailing parameters are optional, so existing callers are unaffected.
export function computeQuotationTotals(
  subtotal: number,
  discountPercent: number,
  applyGST: boolean,
  gstPercent: number,
  discountMode: QuotationDiscountMode = 'percent',
  discountValue = 0,
): QuotationTotals {
  const safeSubtotal = roundQuotationMoney(subtotal)
  const discountAmount = resolveQuotationDiscount(safeSubtotal, discountPercent, discountMode, discountValue)
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
