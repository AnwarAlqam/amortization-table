# AWS Deployment Notes

This folder contains `app-stack.yaml`, a lightweight CloudFormation stack for:

- VPC with two public subnets and internet routing
- EC2 instance for backend + frontend hosting
- Security group (HTTP/HTTPS + SSH)
- IAM instance role/profile (SSM + CloudWatch + S3 artifact read)
- S3 deployment artifacts bucket
- Optional Route53 `A` record

It also contains `github-actions-iam.yaml`, which bootstraps IAM for GitHub Actions OIDC.

## GitHub Actions requirements

No GitHub environment is required with the current workflow. It reads repository-level secrets/variables.

Set this repository secret (Settings -> Secrets and variables -> Actions -> Secrets):

- `AWS_ROLE_TO_ASSUME`: IAM role ARN trusted for GitHub OIDC and allowed to deploy CloudFormation/SSM/S3 resources.

Set these repository variables (Settings -> Secrets and variables -> Actions -> Variables, minimum):

- `AWS_REGION` (example: `us-east-1`)
- `AWS_STACK_NAME` (example: `amortization-table-prod`)

Optional variables (defaults are applied if missing):

- `PROJECT_NAME`
- `ENVIRONMENT_NAME`
- `VPC_CIDR`
- `PUBLIC_SUBNET_1_CIDR`
- `PUBLIC_SUBNET_2_CIDR`
- `ALLOWED_SSH_CIDR`
- `EC2_INSTANCE_TYPE`
- `ROOT_VOLUME_SIZE`
- `AWS_KEY_PAIR_NAME`
- `ROUTE53_HOSTED_ZONE_ID`
- `ROUTE53_RECORD_NAME`
- `EC2_AMI_ID`

## Bootstrap IAM role (recommended)

Deploy `github-actions-iam.yaml` once (from your AWS CLI):

```bash
aws cloudformation deploy \
  --stack-name amortization-table-github-iam \
  --template-file infra/cloudformation/github-actions-iam.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubOrg=AnwarAlqam \
    GitHubRepo=amortization-table \
    DeploymentBranch=main
```

Then read the role ARN output and set it as `AWS_ROLE_TO_ASSUME` in GitHub secrets.

If your account already has the GitHub OIDC provider, pass `ExistingOidcProviderArn` when deploying.

## Deployment behavior

- Build runs on every branch and pull request.
- Deploy runs only on `push` to `main`.
- Deploy updates the CloudFormation stack, uploads app artifacts to S3, and applies them on EC2 via AWS SSM.
