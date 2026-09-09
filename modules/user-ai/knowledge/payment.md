# Payment Methods & Payment FAQs

## Supported Payment Modes
EpicShow supports all major Indian and international payment methods via high-security payment gateways:
- **UPI (Unified Payments Interface)**: Instant zero-fee checkout via Google Pay, PhonePe, Paytm UPI, BHIM, Cred, and WhatsApp Pay.
- **Credit & Debit Cards**: Visa, MasterCard, RuPay, Diners Club, and American Express. 3D Secure OTP verification is required for all card transactions.
- **Net Banking**: Direct bank transfer support for over 50 leading Indian banks (HDFC, SBI, ICICI, Axis, Kotak, Punjab National Bank, Bank of Baroda).
- **EpicShow Wallet**: Store funds in your preloaded digital wallet for 1-click ultra-fast payments and instant refund credits.

## Gateway Security & Compliance
- **Razorpay Integration**: All checkout flows are processed through Razorpay's PCI-DSS Level 1 certified gateway infrastructure.
- **Data Protection**: EpicShow never stores sensitive card numbers, CVVs, or bank passwords on its servers. All data transmission uses 256-bit SSL/TLS encryption.
- **Tokenization**: Card details are tokenized according to Reserve Bank of India (RBI) compliance guidelines.

## Payment Troubleshooting & Auto-Reconciliation
### What happens if money was deducted from my bank but the ticket was not generated?
If a network timeout or banking gateway hiccup occurs:
1. **Auto-Reconciliation Engine**: Our automated banking reconciliation checks for unconfirmed payment captures every 15 minutes.
2. **Auto-Refund**: If no ticket is confirmed, the deducted amount is automatically refunded to your original payment source.
3. **Timeline**: 
   - Deducted funds typically reflect back in your bank account within **24 hours** for UPI payments.
   - For Net Banking and Cards, banking clearing cycles take **1 to 3 business days**.
4. **Immediate Status Check**: You can verify payment logs and raise an instant dispute under **Profile > Report Issue**.
