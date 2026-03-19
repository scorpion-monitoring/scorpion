import { relations } from 'drizzle-orm/relations';
import {
	category,
	service,
	user,
	userToProvider,
	provider,
	session,
	indicator,
	categoryToIndicator,
	consortium,
	consortiumToService,
	serviceToIndicator,
	serviceForm,
	evaluation,
	apiLogs,
	providerToService,
	measurements,
	userToToken,
	token,
	authenticationMethod,
	publication
} from './schema';

export const serviceRelations = relations(service, ({ one, many }) => ({
	category: one(category, {
		fields: [service.category],
		references: [category.id]
	}),
	consortiumToServices: many(consortiumToService),
	serviceToIndicators: many(serviceToIndicator),
	serviceForms: many(serviceForm),
	providerToServices: many(providerToService),
	measurements: many(measurements),
	publications: many(publication)
}));

export const categoryRelations = relations(category, ({ many }) => ({
	services: many(service),
	categoryToIndicators: many(categoryToIndicator),
	evaluations: many(evaluation)
}));

export const userToProviderRelations = relations(userToProvider, ({ one }) => ({
	user: one(user, {
		fields: [userToProvider.userId],
		references: [user.id]
	}),
	provider: one(provider, {
		fields: [userToProvider.providerId],
		references: [provider.id]
	})
}));

export const userRelations = relations(user, ({ many }) => ({
	userToProviders: many(userToProvider),
	sessions: many(session),
	apiLogs: many(apiLogs),
	userToTokens: many(userToToken),
	authenticationMethods: many(authenticationMethod)
}));

export const providerRelations = relations(provider, ({ many }) => ({
	userToProviders: many(userToProvider),
	providerToServices: many(providerToService)
}));

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	})
}));

export const categoryToIndicatorRelations = relations(categoryToIndicator, ({ one }) => ({
	indicator: one(indicator, {
		fields: [categoryToIndicator.indicatorId],
		references: [indicator.id]
	}),
	category: one(category, {
		fields: [categoryToIndicator.categoryId],
		references: [category.id]
	})
}));

export const indicatorRelations = relations(indicator, ({ many }) => ({
	categoryToIndicators: many(categoryToIndicator),
	serviceToIndicators: many(serviceToIndicator),
	evaluations: many(evaluation),
	measurements: many(measurements)
}));

export const consortiumToServiceRelations = relations(consortiumToService, ({ one }) => ({
	consortium: one(consortium, {
		fields: [consortiumToService.consortiumId],
		references: [consortium.id]
	}),
	service: one(service, {
		fields: [consortiumToService.serviceId],
		references: [service.id]
	})
}));

export const consortiumRelations = relations(consortium, ({ many }) => ({
	consortiumToServices: many(consortiumToService)
}));

export const serviceToIndicatorRelations = relations(serviceToIndicator, ({ one }) => ({
	service: one(service, {
		fields: [serviceToIndicator.serviceId],
		references: [service.id]
	}),
	indicator: one(indicator, {
		fields: [serviceToIndicator.indicatorId],
		references: [indicator.id]
	})
}));

export const serviceFormRelations = relations(serviceForm, ({ one }) => ({
	service: one(service, {
		fields: [serviceForm.serviceId],
		references: [service.id]
	})
}));

export const evaluationRelations = relations(evaluation, ({ one }) => ({
	category: one(category, {
		fields: [evaluation.categoryId],
		references: [category.id]
	}),
	indicator: one(indicator, {
		fields: [evaluation.indicatorId],
		references: [indicator.id]
	})
}));

export const apiLogsRelations = relations(apiLogs, ({ one }) => ({
	user: one(user, {
		fields: [apiLogs.userId],
		references: [user.id]
	})
}));

export const providerToServiceRelations = relations(providerToService, ({ one }) => ({
	provider: one(provider, {
		fields: [providerToService.providerId],
		references: [provider.id]
	}),
	service: one(service, {
		fields: [providerToService.serviceId],
		references: [service.id]
	})
}));

export const measurementsRelations = relations(measurements, ({ one }) => ({
	service: one(service, {
		fields: [measurements.serviceId],
		references: [service.id]
	}),
	indicator: one(indicator, {
		fields: [measurements.indicatorId],
		references: [indicator.id]
	})
}));

export const userToTokenRelations = relations(userToToken, ({ one }) => ({
	user: one(user, {
		fields: [userToToken.userId],
		references: [user.id]
	}),
	token: one(token, {
		fields: [userToToken.tokenId],
		references: [token.id]
	})
}));

export const tokenRelations = relations(token, ({ many }) => ({
	userToTokens: many(userToToken)
}));

export const authenticationMethodRelations = relations(authenticationMethod, ({ one }) => ({
	user: one(user, {
		fields: [authenticationMethod.userId],
		references: [user.id]
	})
}));

export const publicationRelations = relations(publication, ({ one }) => ({
	service: one(service, {
		fields: [publication.serviceId],
		references: [service.id]
	})
}));
