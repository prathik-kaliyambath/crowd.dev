import Error400 from '../errors/Error400'
import SequelizeRepository from '../database/repositories/sequelizeRepository'
import { IServiceOptions } from './IServiceOptions'
import OrganizationRepository from '../database/repositories/organizationRepository'
import MemberRepository from '../database/repositories/memberRepository'
import { CLEARBIT_CONFIG, IS_TEST_ENV } from '../config'
import telemetryTrack from '../segment/telemetryTrack'
import organizationCacheRepository from '../database/repositories/organizationCacheRepository'
import { enrichOrganization } from './helpers/enrichment'
import { LoggingBase } from './loggingBase'
import Plans from '../security/plans'

export default class OrganizationService extends LoggingBase {
  options: IServiceOptions

  constructor(options) {
    super(options)
    this.options = options
  }

  async shouldEnrich(enrichP) {
    const isPremium = this.options.currentTenant.plan === Plans.values.growth
    if (!isPremium) {
      return false
    }
    return enrichP && (CLEARBIT_CONFIG.apiKey || IS_TEST_ENV)
  }

  async findOrCreate(data, enrichP = true) {
    const transaction = await SequelizeRepository.createTransaction(this.options)

    if (!data.name) {
      throw new Error400(this.options.language, 'errors.OrganizationNameRequired.message')
    }

    try {
      const shouldDoEnrich = await this.shouldEnrich(enrichP)

      // check cache existing by name
      let cache = await organizationCacheRepository.findByName(data.name, {
        ...this.options,
        transaction,
      })

      // if cache exists, merge current data with cache data
      // if it doesn't exist, create it from incoming data
      if (cache) {
        data = {
          ...cache,
          ...data,
        }
        cache = await organizationCacheRepository.update(cache.id, data, {
          ...this.options,
          transaction,
        })
      } else {
        // save it to cache
        cache = await organizationCacheRepository.create(data, {
          ...this.options,
          transaction,
        })
      }

      // clearbit enrich
      if (shouldDoEnrich && !cache.enriched) {
        try {
          const enrichedData = await enrichOrganization(data.name)

          // overwrite cache with enriched data, but keep the name because it's serving as a unique identifier
          data = {
            ...cache,
            ...enrichedData,
            name: cache.name,
            enriched: true,
          }

          cache = await organizationCacheRepository.update(cache.id, data, {
            ...this.options,
            transaction,
          })
        } catch (error) {
          this.log.error(error, `Could not enrich ${data.name}!`)
        }
      }

      if (data.members) {
        cache.members = await MemberRepository.filterIdsInTenant(data.members, {
          ...this.options,
          transaction,
        })
      }

      let record

      const existingByName = await OrganizationRepository.findByName(data.name, {
        ...this.options,
        transaction,
      })

      if (existingByName) {
        record = await this.update(existingByName.id, cache)
      } else {
        record = await OrganizationRepository.create(cache, {
          ...this.options,
          transaction,
        })
        telemetryTrack(
          'Organization created',
          {
            id: record.id,
            createdAt: record.createdAt,
          },
          this.options,
        )
      }

      await SequelizeRepository.commitTransaction(transaction)

      return record
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction)

      SequelizeRepository.handleUniqueFieldError(error, this.options.language, 'organization')

      throw error
    }
  }

  async update(id, data) {
    const transaction = await SequelizeRepository.createTransaction(this.options)

    try {
      if (data.members) {
        data.members = await MemberRepository.filterIdsInTenant(data.members, {
          ...this.options,
          transaction,
        })
      }

      const record = await OrganizationRepository.update(id, data, {
        ...this.options,
        transaction,
      })

      await SequelizeRepository.commitTransaction(transaction)

      return record
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction)

      SequelizeRepository.handleUniqueFieldError(error, this.options.language, 'organization')

      throw error
    }
  }

  async destroyAll(ids) {
    const transaction = await SequelizeRepository.createTransaction(this.options)

    try {
      for (const id of ids) {
        await OrganizationRepository.destroy(
          id,
          {
            ...this.options,
            transaction,
          },
          true,
        )
      }

      await SequelizeRepository.commitTransaction(transaction)
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction)
      throw error
    }
  }

  async findById(id) {
    return OrganizationRepository.findById(id, this.options)
  }

  async findAllAutocomplete(search, limit) {
    return OrganizationRepository.findAllAutocomplete(search, limit, this.options)
  }

  async findAndCountAll(args) {
    return OrganizationRepository.findAndCountAll(args, this.options)
  }

  async query(data) {
    const advancedFilter = data.filter
    const orderBy = data.orderBy
    const limit = data.limit
    const offset = data.offset
    return OrganizationRepository.findAndCountAll(
      { advancedFilter, orderBy, limit, offset },
      this.options,
    )
  }

  async destroyBulk(ids) {
    const transaction = await SequelizeRepository.createTransaction(this.options)

    try {
      await OrganizationRepository.destroyBulk(
        ids,
        {
          ...this.options,
          transaction,
        },
        true,
      )

      await SequelizeRepository.commitTransaction(transaction)
    } catch (error) {
      await SequelizeRepository.rollbackTransaction(transaction)
      throw error
    }
  }

  async import(data, importHash) {
    if (!importHash) {
      throw new Error400(this.options.language, 'importer.errors.importHashRequired')
    }

    if (await this._isImportHashExistent(importHash)) {
      throw new Error400(this.options.language, 'importer.errors.importHashExistent')
    }

    const dataToCreate = {
      ...data,
      importHash,
    }

    return this.findOrCreate(dataToCreate)
  }

  async _isImportHashExistent(importHash) {
    const count = await OrganizationRepository.count(
      {
        importHash,
      },
      this.options,
    )

    return count > 0
  }
}
