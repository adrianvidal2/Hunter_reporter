# EXAMPLE TARGET — DEEP-DIVE HUNT NOTES

**Target:** www.example-target.com (Example Program, HIGH, only in-scope asset)
**Method:** white-box subagents (decompilation of deployed assemblies + stored
procedures) + live scope verification.
**Verification status:** ✅ confirmed live | 🔬 solid white-box

---

## NEW — Financial IDOR without authentication

`Store.CartMaintenance.Modules.PaymentInvoiceModule.cs:129-132` +
`PaymentInvoiceBFO.cs:44-60`:

```csharp
private ShoppingCartPaymentInvoiceEntity CartInvoice {
    get {
        if (_cartInvoice == null && ((UserControl)this).Request.QueryString["InvoiceNumber"] != null)
            _cartInvoice = PaymentInvoiceBFO.GetShoppingCartPaymentInvoiceByInvoiceNumber(Request.QueryString["InvoiceNumber"]);
        return _cartInvoice; } }
```

- `GetShoppingCartPaymentInvoiceByInvoiceNumber` = `GetMulti(InvoiceNumber == value)`
  **without any customer/session predicate**.
- `PaymentInvoicePopup.ValidateMasterOrder()` **overridden to empty**
  (PaymentInvoicePopup.cs:19-22), skipping the binding check.
- **Endpoints:** `/pws/POE/Handlers/PaymentInvoiceHandler.ashx?InvoiceNumber=<n>`
  / `/pws/PublicStore/CartMaintenance/PaymentInvoice.aspx?InvoiceNumber=<n>`.

## Impact

An unauthenticated attacker can enumerate invoice numbers and retrieve other
customers' financial documents.
