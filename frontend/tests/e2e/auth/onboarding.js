import data from './data.json'

export default () => {
  before(() => {
    cy.url().should('include', '/onboard')
  })

  beforeEach(() => {
    cy.get('#tenantName').as('tenantName')
    cy.get('#tenantSize').as('tenantSize')
    cy.get('#tenantPlatformsItem .el-select').as(
      'tenantPlatformSelect'
    )
    cy.get('#submit').as('submit')
  })

  it('Should display correct selected platforms', () => {
    cy.get('@tenantPlatformSelect').click()
    for (let platform of data.tenant.platforms) {
      cy.get('.el-select-dropdown')
        .contains(platform)
        .closest('.el-select-dropdown__item')
        .click()
    }

    for (let platform of data.tenant.platforms) {
      cy.get('@tenantPlatformSelect')
        .get('.el-select__tags')
        .should('contain.text', platform)
    }
  })

  it('Does not submit if community size is not selected', () => {
    cy.get('@tenantName').clear().type(data.tenant.name)

    cy.url().should('include', '/onboard')
    cy.get('@submit').should('be.disabled')
  })

  it('Does not submit if community name is empty', () => {
    cy.get('@tenantName').clear()
    cy.get('@tenantSize').contains(data.tenant.size).click()

    cy.url().should('include', '/onboard')
    cy.get('@submit').should('be.disabled')
    cy.get('form')
      .contains('This field is required')
      .should('exist')
  })

  it('Does not submit if community platforms are not selected', () => {
    cy.get('@tenantName').clear().type(data.tenant.name)
    cy.get('@tenantSize').contains(data.tenant.size).click()

    for (let platform of data.tenant.platforms) {
      cy.get('@tenantPlatformSelect')
        .contains(platform)
        .closest('.el-tag')
        .find('.el-tag__close')
        .click()
    }

    cy.url().should('include', '/onboard')
    cy.get('@submit').should('be.disabled')
    cy.get('form')
      .contains('This field is required')
      .should('exist')
  })

  it('Finishes onboarding if all fields are valid', () => {
    cy.get('@tenantPlatformSelect').click()
    for (let platform of data.tenant.platforms) {
      cy.get('.el-select-dropdown')
        .contains(platform)
        .closest('.el-select-dropdown__item')
        .click()
    }
    cy.get('@tenantName').clear().type(data.tenant.name)
    cy.get('@tenantSize').contains(data.tenant.size).click()
    cy.get('@submit').should('not.be.disabled')
    cy.get('@submit').click()
    cy.wait(4000)

    cy.url().should('not.include', '/onboard')
    cy.location('pathname').should('eq', '/')
  })
}
