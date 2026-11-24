# What the server costs

Written 2026-11-24. Prices are in US dollars, before tax. **Check them in the AWS console before you rely on
them**: the hourly rate below comes from third-party price trackers, not from AWS's own page.

## The AWS free plan

- The account is on the AWS **free plan**: $100 in credits at sign-up plus $20 earned (the budget activity), so
  $120 in total. The credits pay for EC2, the disk and the IP address below.
- **The plan ends on 2027-05-24**, or earlier if the credits run out. AWS then closes the account unless it is
  upgraded. Back up the database to the laptop before either date (RUNBOOK, "Backup").
- **Do not click "Upgrade plan"** (in the console banner or on the Billing pages) unless you mean to start
  paying by card. Upgrading turns the account into a paid account: usage beyond the credits is then charged.

## The parts that cost money

| Item | Rate (ap-southeast-2, Sydney) | Source |
| --- | --- | --- |
| m7i-flex.large, Linux, on demand | **about $0.1197 an hour** | aws-pricing.com and devzero.io ($0.120); cloudpricer.io says $0.1873. **Not confirmed on AWS's own page.** |
| EBS gp3 disk | about $0.096 per GB a month | from memory of AWS's EBS price list; **not confirmed today** |
| Public IPv4 address (the Elastic IP) | $0.005 an hour, attached or not | AWS's public IPv4 charge (since February 2024), from memory; **not confirmed today** |
| Data out to the internet | the first 100 GB a month free (all regions together), then about $0.114 per GB from Sydney | from memory; **not confirmed today** |

The disk size is not in this repository. Look it up under **EC2 → Volumes**. The figures below assume
**40 GB**; for another size, the disk cost is size × $0.096.

## Per month

| | Instance | Disk (40 GB) | Elastic IP | **Total** | $120 of credit lasts |
| --- | --- | --- | --- | --- | --- |
| **Running 24/7** (730 h) | $87.38 | $3.84 | $3.65 | **about $95** | about 5 weeks |
| **Stopped all month** | $0 | $3.84 | $3.65 | **about $7.50** | about 16 months (past the plan's end) |
| Running 4 h a day (122 h) | $14.60 | $3.84 | $3.65 | **about $22** | about 5 months |

So **leaving it running all the time uses up the credit in about five weeks.** Stop it when nobody is using it
(RUNBOOK, "Stop the instance when idle").

Data transfer is left out. Map tiles and routes are small: a session loads a few MB of tiles. It matters only if
the site gets more than about 100 GB of traffic a month.

## How to check the credit balance

1. AWS console → search bar → **Billing and Cost Management**.
2. Left menu → **Credits**. It shows the remaining amount and the expiry date.
3. **Bills** (left menu) shows this month's charges per service. They should be covered by credits ("Credits
   applied").
4. Optional: **Budgets → Create budget → Zero spend budget** emails you when anything is charged beyond the
   credits.

Check the exact hourly rate here: **EC2 → Instances → Launch instance →** pick `m7i-flex.large` and Sydney.
The price is shown next to the type. Or use the AWS Pricing Calculator (https://calculator.aws).
