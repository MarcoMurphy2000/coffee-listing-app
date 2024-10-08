import {Construct} from 'constructs';
import * as cdk from 'aws-cdk-lib';
import {RestApiStack} from './rest-api-stack';
import {WebsiteHostingStack} from './website-hosting-stack';
import * as pipelines from 'aws-cdk-lib/pipelines';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codestar from 'aws-cdk-lib/aws-codestarconnections';

export class CoffeeListingAppStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Create a CodeStar connection to GitHub
        const connection = new codestar.CfnConnection(this, 'GitHubConnection', {
            connectionName: 'CoffeeListingAppGitHubConn', // Shortened to 32 characters
            providerType: 'GitHub',
        });

        let appStage = new AppStage(this, 'AppStage', {
            stackName: this.stackName,
        });

        let pipeline = new pipelines.CodePipeline(this, 'Pipeline', {
            pipelineName: `Pipeline-${this.stackName.substring(0, 20)}`, // Ensure pipeline name is not too long
            selfMutation: false,
            publishAssetsInParallel: false,
            synth: new pipelines.ShellStep('Synth', {
                input: pipelines.CodePipelineSource.connection(
                    'MarcoMurphy2000/coffee-listing-app',
                    'main',
                    {
                        connectionArn: connection.attrConnectionArn,
                    }
                ),
                installCommands: ['npm i -g npm@latest'],
                commands: ['npm ci', 'npm run build', 'npx cdk synth'],
            }),
            codeBuildDefaults: {
                rolePolicy: [
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: ['s3:*'],
                        resources: ['*'],
                    }),
                    new iam.PolicyStatement({
                        effect: iam.Effect.ALLOW,
                        actions: ['cloudfront:*'],
                        resources: ['*'],
                    }),
                ],
            },
        });

        pipeline.addStage(appStage, {
            post: [
                new pipelines.ShellStep('DeployFrontEnd', {
                    envFromCfnOutputs: {
                        SNOWPACK_PUBLIC_CLOUDFRONT_URL: appStage.cfnOutCloudFrontUrl,
                        SNOWPACK_PUBLIC_API_IMAGES_URL: appStage.cfnOutApiImagesUrl,
                        BUCKET_NAME: appStage.cfnOutBucketName,
                        DISTRIBUTION_ID: appStage.cfnOutDistributionId,
                    },
                    commands: [
                        'cd frontend',
                        'npm ci',
                        'npm run build',
                        'aws s3 cp ./src/build s3://$BUCKET_NAME/frontend --recursive',
                        `aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"`,
                    ],
                }),
            ],
        });

        new cdk.CfnOutput(this, 'GitHubConnectionArn', {
            value: connection.attrConnectionArn,
            description: 'GitHub Connection ARN',
        });
    }
}

interface AppStageProps extends cdk.StageProps {
    stackName: string;
}

class AppStage extends cdk.Stage {
    public readonly cfnOutApiImagesUrl: cdk.CfnOutput;
    public readonly cfnOutCloudFrontUrl: cdk.CfnOutput;
    public readonly cfnOutBucketName: cdk.CfnOutput;
    public readonly cfnOutDistributionId: cdk.CfnOutput;

    constructor(scope: Construct, id: string, props: AppStageProps) {
        super(scope, id, props);
        let websiteHosting = new WebsiteHostingStack(this, 'WebsiteHostingStack', {
            stackName: `WebHosting-${props.stackName.substring(0, 20)}`, // Ensure stack name is not too long
        });
        let restApi = new RestApiStack(this, 'RestApiStack', {
            stackName: `RestApi-${props.stackName.substring(0, 20)}`, // Ensure stack name is not too long
            bucket: websiteHosting.bucket,
            distribution: websiteHosting.distribution,
        });

        this.cfnOutApiImagesUrl = restApi.cfnOutApiImagesUrl;
        this.cfnOutCloudFrontUrl = websiteHosting.cfnOutCloudFrontUrl;
        this.cfnOutBucketName = websiteHosting.cfnOutBucketName;
        this.cfnOutDistributionId = websiteHosting.cfnOutDistributionId;
    }
}
