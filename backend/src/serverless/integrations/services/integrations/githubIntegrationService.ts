import moment from 'moment/moment'
import { createAppAuth } from '@octokit/auth-app'
import verifyGithubWebhook from 'verify-github-webhook'
import { Repo, Repos } from '../../types/regularTypes'
import { IntegrationType, PlatformType } from '../../../../types/integrationEnums'
import {
  IIntegrationStream,
  IPendingStream,
  IProcessStreamResults,
  IProcessWebhookResults,
  IStepContext,
} from '../../../../types/integration/stepResult'
import MemberAttributeSettingsService from '../../../../services/memberAttributeSettingsService'
import { GithubMemberAttributes } from '../../../../database/attributes/member/github'
import { MemberAttributeName } from '../../../../database/attributes/member/enums'
import { TwitterMemberAttributes } from '../../../../database/attributes/member/twitter'
import { GITHUB_CONFIG, IS_TEST_ENV } from '../../../../config'
import StargazersQuery from '../../usecases/github/graphql/stargazers'
import { IntegrationServiceBase } from '../integrationServiceBase'
import { timeout } from '../../../../utils/timing'
import PullRequestsQuery from '../../usecases/github/graphql/pullRequests'
import PullRequestCommentsQuery from '../../usecases/github/graphql/pullRequestComments'
import IssuesQuery from '../../usecases/github/graphql/issues'
import IssueCommentsQuery from '../../usecases/github/graphql/issueComments'
import ForksQuery from '../../usecases/github/graphql/forks'
import DiscussionsQuery from '../../usecases/github/graphql/discussions'
import DiscussionCommentsQuery from '../../usecases/github/graphql/discussionComments'
import { AddActivitiesSingle, Member } from '../../types/messageTypes'
import Operations from '../../../dbOperations/operations'
import { GithubActivityType } from '../../../../types/activityTypes'
import { GitHubGrid } from '../../grid/githubGrid'
import getOrganization from '../../usecases/github/graphql/organizations'
import { singleOrDefault } from '../../../../utils/arrays'
import { AppTokenResponse, getAppToken } from '../../usecases/github/rest/getAppToken'
import getMember from '../../usecases/github/graphql/members'
import { createRedisClient } from '../../../../utils/redis'
import { RedisCache } from '../../../../utils/redis/redisCache'
import { gridEntry } from '../../grid/grid'

/* eslint class-methods-use-this: 0 */

/* eslint-disable @typescript-eslint/no-unused-vars */

/* eslint-disable no-case-declarations */

enum GithubStreamType {
  STARGAZERS = 'stargazers',
  FORKS = 'forks',
  PULLS = 'pulls',
  PULL_COMMENTS = 'pull-comments',
  ISSUES = 'issues',
  ISSUE_COMMENTS = 'issue-comments',
  DISCUSSIONS = 'discussions',
  DISCUSSION_COMMENTS = 'discussion-comments',
}

const privateKey = GITHUB_CONFIG.privateKey
  ? Buffer.from(GITHUB_CONFIG.privateKey, 'base64').toString('ascii')
  : undefined

export class GithubIntegrationService extends IntegrationServiceBase {
  private static githubAuthenticator = privateKey
    ? createAppAuth({
        appId: GITHUB_CONFIG.appId,
        clientId: GITHUB_CONFIG.clientId,
        clientSecret: GITHUB_CONFIG.clientSecret,
        privateKey,
      })
    : undefined

  constructor() {
    super(IntegrationType.GITHUB, -1)

    this.globalLimit = GITHUB_CONFIG.globalLimit || 0
  }

  async createMemberAttributes(context: IStepContext): Promise<void> {
    const service = new MemberAttributeSettingsService(context.repoContext)
    await service.createPredefined(GithubMemberAttributes)
    await service.createPredefined(
      MemberAttributeSettingsService.pickAttributes(
        [MemberAttributeName.URL],
        TwitterMemberAttributes,
      ),
    )
  }

  async preprocess(context: IStepContext): Promise<void> {
    const redis = await createRedisClient(true)
    const emailCache = new RedisCache('github-emails', redis)

    const repos: Repos = []
    const unavailableRepos: Repos = []

    const reposToCheck = [
      ...context.integration.settings.repos,
      ...(context.integration.settings.unavailableRepos || []),
    ]

    for (const repo of reposToCheck) {
      try {
        // we don't need to get default 100 item per page, just 1 is enough to check if repo is available
        const stargazersQuery = new StargazersQuery(repo, context.integration.token, 1)
        await stargazersQuery.getSinglePage('')
        repos.push(repo)
      } catch (e) {
        if (e.rateLimitResetSeconds) {
          throw e
        } else {
          context.logger.warn(
            `Repo ${repo.name} will not be parsed. It is not available with the github token`,
          )
          unavailableRepos.push(repo)
        }
      }
    }

    context.integration.settings.repos = repos
    context.integration.settings.unavailableRepos = unavailableRepos

    context.pipelineData = {
      repos,
      unavailableRepos,
      emailCache,
    }
  }

  async getStreams(context: IStepContext): Promise<IPendingStream[]> {
    return context.pipelineData.repos.reduce((acc, repo) => {
      for (const endpoint of [
        GithubStreamType.STARGAZERS,
        // GithubStreamType.FORKS,
        GithubStreamType.PULLS,
        GithubStreamType.ISSUES,
        GithubStreamType.DISCUSSIONS,
      ]) {
        acc.push({
          value: endpoint,
          metadata: { repo, page: '' },
        })
      }
      return acc
    }, [])
  }

  async processStream(
    stream: IIntegrationStream,
    context: IStepContext,
  ): Promise<IProcessStreamResults> {
    await timeout(1000)

    const repoName = stream.metadata.repo.name
    const event = stream.value as GithubStreamType

    const repo = GithubIntegrationService.getRepoByName(repoName, context)

    if (repo === null) {
      throw new Error(`Repo ${repoName} not found!`)
    }

    if (!repo.available) {
      throw new Error(
        `Stream ${stream.value} can't be processed since repo ${repoName} is not available!`,
      )
    }

    let result
    let newStreams: IPendingStream[]

    switch (event) {
      case GithubStreamType.STARGAZERS:
        const stargazersQuery = new StargazersQuery(repo, context.integration.token)
        result = await stargazersQuery.getSinglePage(stream.metadata.page)
        result.data = result.data.filter((i) => (i as any).node?.login)
        break
      case GithubStreamType.FORKS:
        const forksQuery = new ForksQuery(repo, context.integration.token)
        result = await forksQuery.getSinglePage(stream.metadata.page)

        // filter out activities without authors (such as bots) -- may not the case for forks, but filter out anyway
        result.data = result.data.filter((i) => (i as any).owner?.login)
        break
      case GithubStreamType.PULLS:
        const pullRequestsQuery = new PullRequestsQuery(repo, context.integration.token)
        result = await pullRequestsQuery.getSinglePage(stream.metadata.page)

        // filter out activities without authors (such as bots)
        result.data = result.data.filter((i) => (i as any).author?.login)

        // add each PR as separate stream
        newStreams = result.data.map((pr) => ({
          value: GithubStreamType.PULL_COMMENTS,
          metadata: {
            page: '',
            repo: stream.metadata.repo,
            prNumber: pr.number,
          },
        }))
        break
      case GithubStreamType.PULL_COMMENTS:
        const pullRequestNumber = stream.metadata.prNumber
        const pullRequestCommentsQuery = new PullRequestCommentsQuery(
          repo,
          pullRequestNumber,
          context.integration.token,
        )

        result = await pullRequestCommentsQuery.getSinglePage(stream.metadata.page)
        result.data = result.data.filter((i) => (i as any).author?.login)
        break
      case GithubStreamType.ISSUES:
        const issuesQuery = new IssuesQuery(repo, context.integration.token)
        result = await issuesQuery.getSinglePage(stream.metadata.page)

        // filter out activities without authors (such as bots)
        result.data = result.data.filter((i) => (i as any).author?.login)

        // add each issue as separate stream
        newStreams = result.data.map((issue) => ({
          value: GithubStreamType.ISSUE_COMMENTS,
          metadata: {
            page: '',
            repo: stream.metadata.repo,
            issueNumber: issue.number,
          },
        }))
        break
      case GithubStreamType.ISSUE_COMMENTS:
        const issueNumber = stream.metadata.issueNumber
        const issueCommentsQuery = new IssueCommentsQuery(
          repo,
          issueNumber,
          context.integration.token,
        )
        result = await issueCommentsQuery.getSinglePage(stream.metadata.page)
        result.data = result.data.filter((i) => (i as any).author?.login)
        break
      case GithubStreamType.DISCUSSIONS:
        const discussionsQuery = new DiscussionsQuery(repo, context.integration.token)
        result = await discussionsQuery.getSinglePage(stream.metadata.page)

        result.data = result.data.filter((i) => (i as any).author?.login)
        newStreams = result.data
          .filter((d) => d.comments.totalCount > 0)
          .map((d) => ({
            value: GithubStreamType.DISCUSSION_COMMENTS,
            metadata: {
              page: '',
              repo: stream.metadata.repo,
              discussionNumber: d.number,
            },
          }))
        break
      case GithubStreamType.DISCUSSION_COMMENTS:
        const discussionNumber = stream.metadata.discussionNumber
        const discussionCommentsQuery = new DiscussionCommentsQuery(
          repo,
          discussionNumber,
          context.integration.token,
        )
        result = await discussionCommentsQuery.getSinglePage(stream.metadata.page)
        result.data = result.data.filter((i) => (i as any).author?.login)
        break
      default:
        throw new Error(`Unknown event '${event}'!`)
    }

    const nextPageStream = result.hasPreviousPage
      ? { value: stream.value, metadata: { repo: stream.metadata.repo, page: result.startCursor } }
      : undefined

    const activities = await GithubIntegrationService.parseActivities(
      result.data,
      stream.value as GithubStreamType,
      repo,
      context,
    )

    return {
      operations: [
        {
          type: Operations.UPSERT_ACTIVITIES_WITH_MEMBERS,
          records: activities,
        },
      ],
      newStreams,
      nextPageStream,
    }
  }

  async processWebhook(webhook: any, context: IStepContext): Promise<IProcessWebhookResults> {
    let record: AddActivitiesSingle | undefined

    await GithubIntegrationService.verifyWebhookSignature(
      webhook.payload.signature,
      webhook.payload.data,
    )

    const event = webhook.payload.event
    const payload = webhook.payload.data

    const redis = await createRedisClient(true)
    const emailCache = new RedisCache('github-emails', redis)

    context.pipelineData = {
      emailCache,
    }

    switch (event) {
      case 'issues': {
        record = await GithubIntegrationService.parseWebhookIssue(payload, context)
        break
      }

      case 'discussion': {
        record = await GithubIntegrationService.parseWebhookDiscussion(payload, context)
        break
      }

      case 'pull_request': {
        record = await GithubIntegrationService.parseWebhookPullRequest(payload, context)
        break
      }

      case 'star': {
        record = await GithubIntegrationService.parseWebhookStar(payload, context)
        break
      }

      case 'fork': {
        record = await GithubIntegrationService.parseWebhookFork(payload, context)
        break
      }

      case 'discussion_comment':
      case 'issue_comment': {
        record = await GithubIntegrationService.parseWebhookComment(event, payload, context)
        break
      }

      default:
    }

    if (record === undefined) {
      context.logger.warn(
        {
          event,
          action: payload.action,
        },
        'No record created for event!',
      )

      return {
        operations: [],
      }
    }

    return {
      operations: [
        {
          type: Operations.UPSERT_ACTIVITIES_WITH_MEMBERS,
          records: [record],
        },
      ],
    }
  }

  private static verifyWebhookSignature(signature: string, data: any): void {
    if (IS_TEST_ENV) {
      return
    }

    const secret = GITHUB_CONFIG.webhookSecret

    let isVerified: boolean
    try {
      isVerified = verifyGithubWebhook(signature, JSON.stringify(data), secret) // Returns true if verification succeeds; otherwise, false.
    } catch (err) {
      throw new Error(`Webhook not verified\n${err}`)
    }

    if (!isVerified) {
      throw new Error('Webhook not verified')
    }
  }

  /**
   * Parses various activity types into crowd activities.
   * @param records List of activities to be parsed
   * @param event
   * @param repo
   * @param context
   * @returns parsed activities that can be saved to the database.
   */
  private static async parseActivities(
    records: any[],
    event: GithubStreamType,
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    let activities: AddActivitiesSingle[] = []

    switch (event) {
      case GithubStreamType.STARGAZERS:
        activities = await GithubIntegrationService.parseStars(records, repo, context)
        break
      case GithubStreamType.FORKS:
        activities = await GithubIntegrationService.parseForks(records, repo, context)
        break
      case GithubStreamType.PULLS:
        activities = await GithubIntegrationService.parsePullRequests(records, repo, context)
        break
      case GithubStreamType.PULL_COMMENTS:
        activities = await GithubIntegrationService.parsePullRequestComments(records, repo, context)
        break
      case GithubStreamType.ISSUES:
        activities = await GithubIntegrationService.parseIssues(records, repo, context)
        break
      case GithubStreamType.ISSUE_COMMENTS:
        activities = await GithubIntegrationService.parseIssueComments(records, repo, context)
        break
      case GithubStreamType.DISCUSSIONS:
        activities = await GithubIntegrationService.parseDiscussions(records, repo, context)
        break
      case GithubStreamType.DISCUSSION_COMMENTS:
        activities = await GithubIntegrationService.parseDiscussionComments(records, repo, context)
        break
      default:
        throw new Error(`Event not supported '${event}'!`)
    }

    return activities
  }

  public static async parseWebhookStar(
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    let type: GithubActivityType
    switch (payload.action) {
      case 'created': {
        type = GithubActivityType.STAR
        break
      }

      case 'deleted': {
        type = GithubActivityType.UNSTAR
        break
      }

      default: {
        return undefined
      }
    }
    const member = await GithubIntegrationService.parseWebhookMember(payload.sender.login, context)

    if (member) {
      const starredAt =
        type === GithubActivityType.STAR ? moment(payload.starred_at).utc() : moment().utc()

      return {
        member,
        type,
        timestamp: starredAt.toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: IntegrationServiceBase.generateSourceIdHash(
          payload.sender.login,
          type,
          starredAt.unix().toString(),
          PlatformType.GITHUB,
        ),
        sourceParentId: null,
        channel: payload.repository.html_url,
        score: type === 'star' ? GitHubGrid.star.score : GitHubGrid.unStar.score,
        isContribution: GitHubGrid.star.isContribution,
      }
    }

    return undefined
  }

  private static async parseStars(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []
    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.STAR,
        sourceId: IntegrationServiceBase.generateSourceIdHash(
          record.node.login,
          GithubActivityType.STAR,
          moment(record.starredAt).utc().unix().toString(),
          PlatformType.GITHUB,
        ),
        sourceParentId: '',
        timestamp: moment(record.starredAt).utc().toDate(),
        channel: repo.url,
        member: await GithubIntegrationService.parseMember(record.node, context),
        score: GitHubGrid.star.score,
        isContribution: GitHubGrid.star.isContribution,
      })
    }
    return out
  }

  public static async parseWebhookFork(
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    const member: Member = await GithubIntegrationService.parseWebhookMember(
      payload.sender.login,
      context,
    )

    if (member) {
      return {
        member,
        type: GithubActivityType.FORK,
        timestamp: moment(payload.forkee.created_at).utc().toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: payload.forkee.node_id.toString(),
        sourceParentId: null,
        channel: payload.repository.html_url,
        score: GitHubGrid.fork.score,
        isContribution: GitHubGrid.fork.isContribution,
      }
    }
    return undefined
  }

  private static async parseForks(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []

    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.FORK,
        sourceId: record.id,
        sourceParentId: '',
        timestamp: moment(record.createdAt).utc().toDate(),
        channel: repo.url,
        member: await GithubIntegrationService.parseMember(record.owner, context),
        score: GitHubGrid.fork.score,
        isContribution: GitHubGrid.fork.isContribution,
      })
    }

    return out
  }

  public static async parseWebhookPullRequest(
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    let type: GithubActivityType
    let scoreGrid: gridEntry
    let timestamp: string

    switch (payload.action) {
      case 'edited':
      case 'opened':
      case 'reopened': {
        type = GithubActivityType.PULL_REQUEST_OPENED
        scoreGrid = GitHubGrid.pullRequestOpened
        timestamp = payload.pull_request.created_at
        break
      }

      case 'closed': {
        type = GithubActivityType.PULL_REQUEST_CLOSED
        scoreGrid = GitHubGrid.pullRequestClosed
        timestamp = payload.pull_request.closed_at
        break
      }

      default: {
        return undefined
      }
    }

    const pull = payload.pull_request
    const member = await GithubIntegrationService.parseWebhookMember(pull.user.login, context)

    if (member) {
      return {
        member,
        type,
        timestamp: moment(timestamp).utc().toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: pull.node_id.toString(),
        sourceParentId: null,
        url: pull.html_url,
        title: pull.title,
        channel: payload.repository.html_url,
        body: pull.body,
        score: scoreGrid.score,
        isContribution: scoreGrid.isContribution,
      }
    }

    return undefined
  }

  private static async parsePullRequests(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []

    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.PULL_REQUEST_OPENED,
        sourceId: record.id,
        sourceParentId: '',
        timestamp: moment(record.createdAt).utc().toDate(),
        body: record.bodyText,
        url: record.url ? record.url : '',
        channel: repo.url,
        title: record.title,
        attributes: {
          state: record.state.toLowerCase(),
        },
        member: await GithubIntegrationService.parseMember(record.author, context),
        score: GitHubGrid.pullRequestOpened.score,
        isContribution: GitHubGrid.pullRequestOpened.isContribution,
      })
    }

    return out
  }

  public static async parseWebhookComment(
    event: string,
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    let type: GithubActivityType
    let sourceParentId: string | undefined

    switch (event) {
      case 'discussion_comment': {
        switch (payload.action) {
          case 'created':
          case 'edited':
            type = GithubActivityType.DISCUSSION_COMMENT
            sourceParentId = payload.discussion.node_id.toString()
            break
          default:
            return undefined
        }
        break
      }

      case 'issue_comment': {
        switch (payload.action) {
          case 'created':
          case 'edited': {
            if ('pull_request' in payload.issue) {
              type = GithubActivityType.PULL_REQUEST_COMMENT
            } else {
              type = GithubActivityType.ISSUE_COMMENT
            }
            sourceParentId = payload.issue.node_id.toString()
            break
          }

          default:
            return undefined
        }
        break
      }

      default: {
        return undefined
      }
    }

    const member = await GithubIntegrationService.parseWebhookMember(payload.sender.login, context)
    if (member) {
      const comment = payload.comment
      return {
        member,
        type,
        timestamp: moment(comment.created_at).utc().toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: comment.node_id.toString(),
        sourceParentId,
        url: comment.html_url,
        body: comment.body,
        channel: payload.repository.html_url,
        score: GitHubGrid.comment.score,
        isContribution: GitHubGrid.comment.isContribution,
      }
    }

    return undefined
  }

  private static async parsePullRequestComments(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []
    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.PULL_REQUEST_COMMENT,
        sourceId: record.id,
        sourceParentId: record.pullRequest.id,
        timestamp: moment(record.createdAt).utc().toDate(),
        url: record.url,
        body: record.bodyText,
        channel: repo.url,
        member: await GithubIntegrationService.parseMember(record.author, context),
        score: GitHubGrid.comment.score,
        isContribution: GitHubGrid.comment.isContribution,
      })
    }
    return out
  }

  public static async parseWebhookIssue(
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    let type: GithubActivityType
    let scoreGrid: gridEntry
    let timestamp: string

    switch (payload.action) {
      case 'edited':
      case 'opened':
      case 'reopened':
        type = GithubActivityType.ISSUE_OPENED
        scoreGrid = GitHubGrid.issueOpened
        timestamp = payload.issue.created_at
        break

      case 'closed':
        type = GithubActivityType.ISSUE_CLOSED
        scoreGrid = GitHubGrid.issueClosed
        timestamp = payload.issue.closed_at
        break

      default:
        return undefined
    }

    const issue = payload.issue
    const member = await GithubIntegrationService.parseWebhookMember(issue.user.login, context)

    if (member) {
      return {
        member,
        type,
        timestamp: moment(timestamp).utc().toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: issue.node_id.toString(),
        sourceParentId: null,
        url: issue.html_url,
        title: issue.title,
        channel: payload.repository.html_url,
        body: issue.body,
        attributes: {
          state: issue.state,
        },
        score: scoreGrid.score,
        isContribution: scoreGrid.isContribution,
      }
    }

    return undefined
  }

  private static async parseIssues(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []

    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.ISSUE_OPENED,
        sourceId: record.id,
        sourceParentId: '',
        timestamp: moment(record.createdAt).utc().toDate(),
        body: record.bodyText,
        url: record.url ? record.url : '',
        channel: repo.url,
        title: record.title.replace(/\0/g, ''),
        attributes: {
          state: record.state.toLowerCase(),
        },
        member: await GithubIntegrationService.parseMember(record.author, context),
        score: GitHubGrid.issueOpened.score,
        isContribution: GitHubGrid.issueOpened.isContribution,
      })
    }

    return out
  }

  private static async parseIssueComments(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []
    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.ISSUE_COMMENT,
        sourceId: record.id,
        sourceParentId: record.issue.id,
        timestamp: moment(record.createdAt).utc().toDate(),
        url: record.url,
        body: record.bodyText,
        channel: repo.url,
        member: await GithubIntegrationService.parseMember(record.author, context),
        score: GitHubGrid.comment.score,
        isContribution: GitHubGrid.comment.isContribution,
      })
    }
    return out
  }

  public static async parseWebhookDiscussion(
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    if (payload.action === 'answered') {
      return this.parseWebhookDiscussionComments(payload, context)
    }

    if (!['edited', 'created'].includes(payload.action)) {
      return undefined
    }

    const discussion = payload.discussion
    const member = await GithubIntegrationService.parseWebhookMember(discussion.user.login, context)

    if (member) {
      return {
        member,
        type: GithubActivityType.DISCUSSION_STARTED,
        timestamp: moment(discussion.created_at).utc().toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: discussion.node_id.toString(),
        sourceParentId: null,
        url: discussion.html_url,
        title: discussion.title,
        channel: payload.repository.html_url,
        body: discussion.body,
        attributes: {
          category: {
            id: discussion.category.node_id,
            isAnswerable: discussion.category.is_answerable,
            name: discussion.category.name,
            slug: discussion.category.slug,
            emoji: discussion.category.emoji,
            description: discussion.category.description,
          },
        },
        score: GitHubGrid.discussionOpened.score,
        isContribution: GitHubGrid.discussionOpened.isContribution,
      }
    }

    return undefined
  }

  private static async parseDiscussions(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []

    for (const record of records) {
      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.DISCUSSION_STARTED,
        sourceId: record.id,
        sourceParentId: '',
        timestamp: moment(record.createdAt).utc().toDate(),
        body: record.bodyText,
        url: record.url ? record.url : '',
        channel: repo.url,
        title: record.title,
        attributes: {
          category: {
            id: record.category.id,
            isAnswerable: record.category.isAnswerable,
            name: record.category.name,
            slug: record.category.slug,
            emoji: record.category.emoji,
            description: record.category.description,
          },
        },
        member: await GithubIntegrationService.parseMember(record.author, context),
        score: GitHubGrid.discussionOpened.score,
        isContribution: GitHubGrid.discussionOpened.isContribution,
      })
    }
    return out
  }

  private static async parseWebhookDiscussionComments(
    payload: any,
    context: IStepContext,
  ): Promise<AddActivitiesSingle | undefined> {
    const member: Member = await this.parseWebhookMember(payload.sender.login, context)

    if (member) {
      const answer = payload.answer
      return {
        member,
        type: GithubActivityType.DISCUSSION_COMMENT,
        timestamp: moment(answer.created_at).utc().toDate(),
        platform: PlatformType.GITHUB,
        tenant: context.integration.tenantId,
        sourceId: answer.node_id.toString(),
        sourceParentId: payload.discussion.node_id.toString(),
        attributes: {
          isSelectedAnswer: true,
        },
        channel: payload.repository.html_url,
        body: answer.body,
        url: answer.html_url,
        score: GitHubGrid.selectedAnswer.score,
        isContribution: GitHubGrid.selectedAnswer.isContribution,
      }
    }

    return undefined
  }

  private static async parseDiscussionComments(
    records: any[],
    repo: Repo,
    context: IStepContext,
  ): Promise<AddActivitiesSingle[]> {
    const out: AddActivitiesSingle[] = []

    for (const record of records) {
      const commentId = record.id

      out.push({
        tenant: context.integration.tenantId,
        platform: PlatformType.GITHUB,
        type: GithubActivityType.DISCUSSION_COMMENT,
        sourceId: commentId,
        sourceParentId: record.discussion.id,
        timestamp: moment(record.createdAt).utc().toDate(),
        url: record.url,
        body: record.bodyText,
        channel: repo.url,
        attributes: {
          isAnswer: record.isAnswer ?? undefined,
        },
        member: await GithubIntegrationService.parseMember(record.author, context),
        score: record.isAnswer ? GitHubGrid.selectedAnswer.score : GitHubGrid.comment.score,
        isContribution: record.isAnswer
          ? GitHubGrid.selectedAnswer.isContribution
          : GitHubGrid.comment.isContribution,
      })

      for (const reply of record.replies.nodes) {
        const member = await GithubIntegrationService.parseMember(reply.author, context)
        out.push({
          tenant: context.integration.tenantId,
          platform: PlatformType.GITHUB,
          type: GithubActivityType.DISCUSSION_COMMENT,
          sourceId: reply.id,
          sourceParentId: commentId,
          timestamp: moment(reply.createdAt).utc().toDate(),
          url: reply.url,
          body: reply.bodyText,
          channel: repo.url,
          member,
          score: GitHubGrid.comment.score,
          isContribution: GitHubGrid.comment.isContribution,
        })
      }
    }

    return out
  }

  private static async getAppToken(context: IStepContext): Promise<string> {
    if (this.githubAuthenticator) {
      let appToken: AppTokenResponse
      if (context.pipelineData.appToken) {
        // check expiration
        const expiration = moment(context.pipelineData.appToken.expiration).add(5, 'minutes')
        if (expiration.isAfter(moment())) {
          // need to refresh
          const authResponse = await this.githubAuthenticator({ type: 'app' })
          const jwtToken = authResponse.token
          appToken = await getAppToken(jwtToken, context.integration.integrationIdentifier)
        } else {
          appToken = context.pipelineData.appToken
        }
      } else {
        const authResponse = await this.githubAuthenticator({ type: 'app' })
        const jwtToken = authResponse.token
        appToken = await getAppToken(jwtToken, context.integration.integrationIdentifier)
      }

      context.pipelineData.appToken = appToken

      return appToken.token
    }

    throw new Error('GitHub integration is not configured!')
  }

  private static async getMemberData(context: IStepContext, login: string): Promise<any> {
    const appToken = await this.getAppToken(context)
    return getMember(login, appToken)
  }

  private static async getMemberEmail(context: IStepContext, login: string): Promise<string> {
    if (IS_TEST_ENV) {
      return ''
    }

    const cache: RedisCache = context.pipelineData.emailCache

    const existing = await cache.getValue(login)
    if (existing) {
      if (existing === 'null') {
        return ''
      }

      return existing
    }

    const member = await this.getMemberData(context, login)
    const email = (member.email || '').trim()
    if (email && email.length > 0) {
      await cache.setValue(login, email, 60 * 60)
      return email
    }

    await cache.setValue(login, 'null', 60 * 60)
    return ''
  }

  private static async parseWebhookMember(
    login: string,
    context: IStepContext,
  ): Promise<Member | undefined> {
    if (IS_TEST_ENV) {
      return {
        username: {
          [PlatformType.GITHUB]: 'testMember',
        },
      }
    }

    const member = await getMember(login, context.integration.token)
    if (member) {
      return GithubIntegrationService.parseMember(member, context)
    }

    return undefined
  }

  public static async parseMember(memberFromApi: any, context: IStepContext): Promise<Member> {
    const email = await this.getMemberEmail(context, memberFromApi.login)

    const member: Member = {
      username: { [PlatformType.GITHUB]: memberFromApi.login },
      displayName: memberFromApi.name,
      attributes: {
        [MemberAttributeName.IS_HIREABLE]: {
          [PlatformType.GITHUB]: memberFromApi.isHireable || false,
        },
        [MemberAttributeName.URL]: {
          [PlatformType.GITHUB]: memberFromApi.url,
        },
        [MemberAttributeName.BIO]: {
          [PlatformType.GITHUB]: memberFromApi.bio || '',
        },
        [MemberAttributeName.LOCATION]: {
          [PlatformType.GITHUB]: memberFromApi.location || '',
        },
        [MemberAttributeName.AVATAR_URL]: {
          [PlatformType.GITHUB]: memberFromApi.avatarUrl || '',
        },
      },
      emails: email ? [email] : [],
    }

    if (memberFromApi.websiteUrl) {
      member.attributes[MemberAttributeName.WEBSITE_URL] = {
        [PlatformType.GITHUB]: memberFromApi.websiteUrl,
      }
    }

    if (memberFromApi.company) {
      if (IS_TEST_ENV) {
        member.organizations = [{ name: 'crowd.dev' }]
      } else {
        const company = memberFromApi.company.replace('@', '').trim()
        const fromAPI = await getOrganization(company, context.integration.token)

        if (fromAPI) {
          member.organizations = [
            {
              name: fromAPI.name,
              description: fromAPI.description ?? null,
              location: fromAPI.location ?? null,
              logo: fromAPI.avatarUrl ?? null,
              url: fromAPI.url ?? null,
              github: fromAPI.url
                ? { handle: fromAPI.url.replace('https://github.com/', '') }
                : null,
              twitter: fromAPI.twitterUsername ? { handle: fromAPI.twitterUsername } : null,
              website: fromAPI.websiteUrl ?? null,
            },
          ]
        } else {
          member.organizations = [{ name: company }]
        }
      }
    }

    if (memberFromApi.twitterUsername) {
      member.attributes[MemberAttributeName.URL][
        PlatformType.TWITTER
      ] = `https://twitter.com/${memberFromApi.twitterUsername}`
      member.username[PlatformType.TWITTER] = memberFromApi.twitterUsername
    }

    if (memberFromApi.followers && memberFromApi.followers.totalCount > 0) {
      member.reach = { [PlatformType.GITHUB]: memberFromApi.followers.totalCount }
    }

    return member
  }

  /**
   * Searches given repository name among installed repositories
   * Returns null if given repo is not found.
   * @param name  The tenant we are working on
   * @param context
   * @returns Found repo object
   */
  private static getRepoByName(name: string, context: IStepContext): Repo | null {
    const availableRepo: Repo | undefined = singleOrDefault(
      context.pipelineData.repos,
      (r) => r.name === name,
    )
    if (availableRepo) {
      return { ...availableRepo, available: true }
    }

    const unavailableRepo: Repo | undefined = singleOrDefault(
      context.pipelineData.unavailableRepos,
      (r) => r.name === name,
    )
    if (unavailableRepo) {
      return { ...unavailableRepo, available: false }
    }

    return null
  }
}
