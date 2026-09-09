# Booking Process & Reservation Rules

## Step-by-Step Booking Workflow
Booking any entertainment or travel experience on EpicShow follows an intuitive, high-speed flow:
1. **Explore & Select**: Choose Movies, Sports, Gaming, or Trains from the home navigation or category catalog.
2. **Select Date, Venue & Showtime**: Pick your target city, venue (cinema hall, sports arena, gaming lounge, or train origin/destination), and desired date and showtime.
3. **Interactive Seat Selection**: Select your preferred seats on the interactive live seating map.
4. **Temporary 8-Minute Seat Lock**: Once selected, the system locks your chosen seats exclusively for your session for 8 minutes to prevent race conditions or double-booking.
5. **Apply Discounts & Coupons**: Enter promo coupon codes or apply available offers under Profile > Offers.
6. **Secure Checkout**: Complete payment via UPI, Credit/Debit Card, Net Banking, or EpicShow Wallet.
7. **Instant Confirmation**: Your digital e-ticket containing a dynamic QR code and complete booking reference is generated immediately.

## Real-Time Seat Lock Architecture & Rules
- **Lock Duration**: Seats are locked exclusively for exactly **8 minutes (480 seconds)** upon selection.
- **Countdown Display**: A live countdown timer is visible on the checkout screen.
- **Automatic Release**: If payment is not completed before the 8-minute timer reaches zero, the locked seats are released back to the global pool via WebSockets so other patrons can book them.
- **Session Limits**: A single user account may select a maximum of **10 seats per booking** for movie screenings and sports fixtures to prevent bulk scalping.

## Booking Confirmation & Receipt
- **In-App Receipt**: Accessible instantly under **Profile > Bookings** with a single click.
- **Encrypted QR Code**: Each ticket features a tamper-proof encrypted QR code containing ticket ID, venue, date, showtime, and seat numbers.
- **Offline Wallet Access**: Tickets can be saved to your device for offline scanning when network connectivity is intermittent.

## AI Assistant Booking Limitations
- **No Direct In-Chat Booking**: The EpicShow AI Assistant ("Ask Epic AI") is designed for discovery, answers, and account assistance. It CANNOT directly book tickets, reserve seats, or process financial transactions inside the chat interface.
- **Secure Self-Checkout**: All ticket purchases must be completed by the user directly through the official EpicShow booking interface. Users should click "View Showtimes" on any movie or event card to select seats on the live interactive map and pay at checkout.
