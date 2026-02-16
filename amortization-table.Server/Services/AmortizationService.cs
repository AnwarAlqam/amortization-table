using System;
using System.Collections.Generic;
using amortization_table.Server.Models;

namespace amortization_table.Server.Services
{
    public class AmortizationService : IServices.IAmortizationService
    {
        public List<AmortizationResponse> CalculateAmortizationSchedule(AmortizationRequest request)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));

            // ------------------------------
            // Railings: reject non-finite inputs (NaN/Infinity)
            // ------------------------------
            if (double.IsNaN(request.purchasePrice) || double.IsInfinity(request.purchasePrice))
                throw new ArgumentException("Purchase price must be a finite number.");
            if (double.IsNaN(request.downPayment) || double.IsInfinity(request.downPayment))
                throw new ArgumentException("Down payment must be a finite number.");
            if (double.IsNaN(request.interest) || double.IsInfinity(request.interest))
                throw new ArgumentException("Interest rate must be a finite number.");

            if (request.paymentFrequency.HasValue)
            {
                var pf = request.paymentFrequency.Value;
                if (double.IsNaN(pf) || double.IsInfinity(pf))
                    throw new ArgumentException("Payment must be a finite number.");
            }

            // ------------------------------
            // Basic validation (no caps)
            // ------------------------------
            if (request.purchasePrice < 0) throw new ArgumentException("Purchase price must be >= 0.");
            if (request.downPayment < 0) throw new ArgumentException("Down payment must be >= 0.");
            if (request.downPayment > request.purchasePrice) throw new ArgumentException("Down payment cannot exceed purchase price.");
            if (request.interest < 0) throw new ArgumentException("Interest rate must be >= 0.");

            // Validate term/payment presence
            bool hasPayment = request.paymentFrequency.HasValue && request.paymentFrequency.Value > 0;
            int? termPeriods = request.term.HasValue ? (int?)request.term.Value : null;

            if (!hasPayment && !termPeriods.HasValue)
                throw new ArgumentException("Payment or term must be provided.");

            if (termPeriods.HasValue && termPeriods.Value <= 0)
                throw new ArgumentException("Term must be > 0 if provided.");

            if (hasPayment && request.paymentFrequency!.Value <= 0)
                throw new ArgumentException("Payment must be > 0 if provided.");

            var response = new List<AmortizationResponse>();

            // Principal
            decimal principal0;
            try
            {
                principal0 = ToMoney(request.purchasePrice - request.downPayment);
            }
            catch (OverflowException)
            {
                throw new ArgumentException("Purchase price/down payment values are too large.");
            }

            // If principal is 0, schedule is trivial
            if (principal0 <= 0m)
            {
                response.Add(new AmortizationResponse
                {
                    beginningBalance = 0,
                    payment = 0,
                    interest = 0,
                    principal = 0,
                    endingBalance = 0
                });
                return response;
            }

            // ------------------------------
            // Term Type support (strict values to avoid weird states)
            // ------------------------------
            string termType = (request.termType ?? "Month").Trim();
            int periodsPerYear = termType switch
            {
                "Week" => 52,
                "Month" => 12,
                "Year" => 1,
                _ => throw new ArgumentException("termType must be one of: Week, Month, Year.")
            };

            // Periodic rate based on term type
            decimal ratePerPeriod;
            try
            {
                ratePerPeriod = (decimal)request.interest / 100m / (decimal)periodsPerYear;
            }
            catch (OverflowException)
            {
                throw new ArgumentException("Interest rate is too large for calculation.");
            }

            // Determine payment (per period)
            decimal paymentExact;
            if (hasPayment)
            {
                try
                {
                    paymentExact = (decimal)request.paymentFrequency!.Value;
                }
                catch (OverflowException)
                {
                    throw new ArgumentException("Payment is too large for calculation.");
                }
            }
            else
            {
                paymentExact = CalculatePaymentExact(principal0, ratePerPeriod, termPeriods!.Value);
            }

            if (paymentExact <= 0m)
                throw new ArgumentException("Payment must be > 0.");

            // ------------------------------
            // Key railing: prevent non-amortizing payment (causes infinite/huge schedules)
            // ------------------------------
            // If payment-only and interest>0, payment must exceed initial interest or principal never decreases.
            if (!termPeriods.HasValue && ratePerPeriod > 0m)
            {
                decimal initialInterest;
                try
                {
                    initialInterest = principal0 * ratePerPeriod;
                }
                catch (OverflowException)
                {
                    throw new ArgumentException("Values are too large during interest calculation. Reduce inputs.");
                }

                if (paymentExact <= initialInterest)
                {
                    throw new ArgumentException(
                        "Payment is too low to cover interest. Increase payment or lower interest rate."
                    );
                }
            }

            // Build schedule
            decimal balance = principal0;

            // If term provided: generate exactly term periods (forcing payoff on last period).
            // If no term: iterate until paid off.
            if (termPeriods.HasValue)
            {
                for (int period = 1; period <= termPeriods.Value; period++)
                {
                    if (balance <= 0m) break;

                    AddPeriodRow(response, ref balance, paymentExact, ratePerPeriod, isForcedPayoffPeriod: (period == termPeriods.Value));
                }

                return response;
            }

            // Payment-only: iterate until payoff
            // NOTE: Without a term, extremely low payments (even if amortizing) can generate very large schedules.
            // This is by design per your request (no server-side caps).
            int periodCounter = 0;
            while (balance > 0m)
            {
                // Prevent int overflow in pathological cases
                if (periodCounter == int.MaxValue)
                    throw new ArgumentException("Schedule is too long to compute (period counter overflow). Consider providing a term.");

                periodCounter++;

                AddPeriodRow(response, ref balance, paymentExact, ratePerPeriod, isForcedPayoffPeriod: false);
            }

            return response;
        }

        // ------------------------------
        // Core row math with railings
        // ------------------------------
        private static void AddPeriodRow(
            List<AmortizationResponse> response,
            ref decimal balance,
            decimal paymentExact,
            decimal ratePerPeriod,
            bool isForcedPayoffPeriod)
        {
            decimal beginningBalanceExact = balance;

            decimal interestExact;
            decimal principalPaidExact;
            try
            {
                interestExact = beginningBalanceExact * ratePerPeriod;
                principalPaidExact = paymentExact - interestExact;
            }
            catch (OverflowException)
            {
                throw new ArgumentException("Values are too large during interest/principal calculation. Reduce inputs.");
            }

            // If principal isn't being reduced, schedule can stall forever
            if (principalPaidExact <= 0m)
            {
                throw new ArgumentException(
                    "Payment is too low to cover interest. Increase payment or lower interest rate."
                );
            }

            decimal paymentThisPeriodExact = paymentExact;

            // Payoff rule:
            // - If forced payoff (last period of fixed term), or the payment would overpay principal, force payoff cleanly.
            if (isForcedPayoffPeriod || principalPaidExact >= beginningBalanceExact)
            {
                principalPaidExact = beginningBalanceExact;
                paymentThisPeriodExact = principalPaidExact + interestExact;
            }

            decimal endingBalanceExact;
            try
            {
                endingBalanceExact = beginningBalanceExact - principalPaidExact;
            }
            catch (OverflowException)
            {
                throw new ArgumentException("Values are too large during ending balance calculation. Reduce inputs.");
            }

            if (endingBalanceExact < 0m) endingBalanceExact = 0m;
            if (Math.Abs(endingBalanceExact) < 0.0000001m) endingBalanceExact = 0m;

            // Output rounding only here
            var beginningOut = RoundMoney(beginningBalanceExact);
            var interestOut = RoundMoney(interestExact);
            var principalOut = RoundMoney(principalPaidExact);
            var paymentOut = RoundMoney(paymentThisPeriodExact);
            var endingOut = RoundMoney(endingBalanceExact);

            if (endingOut < 0m) endingOut = 0m;

            response.Add(new AmortizationResponse
            {
                beginningBalance = (double)beginningOut,
                payment = (double)paymentOut,
                interest = (double)interestOut,
                principal = (double)principalOut,
                endingBalance = (double)endingOut
            });

            balance = endingBalanceExact;
        }

        // ------------------------------
        // Payment formula with division-by-zero railings
        // ------------------------------
        private static decimal CalculatePaymentExact(decimal principal, decimal ratePerPeriod, int termPeriods)
        {
            if (termPeriods <= 0) throw new ArgumentException("Term must be > 0.");

            // 0% interest: straight-line
            if (ratePerPeriod == 0m) return principal / termPeriods;

            double p = (double)principal;
            double r = (double)ratePerPeriod;
            double n = termPeriods;

            if (double.IsNaN(p) || double.IsNaN(r) || double.IsNaN(n) ||
                double.IsInfinity(p) || double.IsInfinity(r) || double.IsInfinity(n))
            {
                throw new ArgumentException("Invalid values in payment calculation.");
            }

            // denom = 1 - (1+r)^(-n)
            double pow = Math.Pow(1.0 + r, -n);
            if (double.IsNaN(pow) || double.IsInfinity(pow))
                throw new ArgumentException("Invalid exponentiation in payment calculation. Check interest/term.");

            double denom = 1.0 - pow;

            // Prevent divide-by-zero / near-zero explosions
            if (denom == 0.0 || Math.Abs(denom) < 1e-18 || double.IsNaN(denom) || double.IsInfinity(denom))
                throw new ArgumentException("Invalid denominator in payment calculation. Check interest/term.");

            double pay = p * r / denom;

            if (double.IsNaN(pay) || double.IsInfinity(pay) || pay <= 0.0)
                throw new ArgumentException("Invalid payment produced by calculation. Check inputs.");

            return (decimal)pay;
        }

        private static decimal RoundMoney(decimal value)
            => Math.Round(value, 2, MidpointRounding.AwayFromZero);

        private static decimal ToMoney(double value)
            => (decimal)value;

        // Keeping these if your interface expects them; they are no longer used in the schedule loop.
        public double CalculateBeginningBalance(double purchasePrice, double downPayment)
            => purchasePrice - downPayment;

        public double CalculateEndingBalance(double beginningBalance, double principalPaid)
            => beginningBalance - principalPaid;

        public double CalculateInterestPaid(double beginningBalance, double interest)
            => beginningBalance * ((interest / 100.0) / 12.0);

        public double CalculatePrincipalPaid(double payment, double interestPaid)
            => payment - interestPaid;
    }
}
