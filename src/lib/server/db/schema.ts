import {
	pgTable,
	text,
	boolean,
	foreignKey,
	unique,
	integer,
	timestamp,
	json,
	pgView,
	jsonb,
	pgEnum
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const aggregateFunction = pgEnum('aggregate_function', ['sum', 'avg', 'min', 'max']);
export const apiMethod = pgEnum('api_method', [
	'DELETE',
	'GET',
	'HEAD',
	'OPTIONS',
	'PATCH',
	'POST',
	'PUT'
]);
export const authMethod = pgEnum('auth_method', ['local', 'oidc']);
export const indicatorCategory = pgEnum('indicator_category', [
	'Bibliographic',
	'Usage',
	'Technical',
	'Satisfaction'
]);
export const indicatorNecessity = pgEnum('indicator_necessity', [
	'mandatory',
	'recommended',
	'optional'
]);
export const indicatorType = pgEnum('indicator_type', ['number', 'text', 'float']);
export const serviceStage = pgEnum('service_stage', ['PROD', 'DEV', 'DEMO']);
export const userRole = pgEnum('user_role', ['Admin', 'Reviewer', 'User']);

export const user = pgTable('user', {
	id: text().primaryKey().notNull(),
	username: text().notNull(),
	email: text().notNull(),
	bio: text(),
	role: userRole().default('User').notNull(),
	approved: boolean().default(false),
	icon: text()
});

export const service = pgTable(
	'service',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'service_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		abbreviation: text().notNull(),
		license: text(),
		name: text().notNull(),
		stage: serviceStage(),
		category: integer().notNull(),
		icon: text()
	},
	(table) => [
		foreignKey({
			columns: [table.category],
			foreignColumns: [category.id],
			name: 'FK_categoryId'
		}),
		unique('service_abbreviation_key').on(table.abbreviation)
	]
);

export const provider = pgTable(
	'provider',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'provider_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		abbreviation: text().notNull(),
		name: text().notNull()
	},
	(table) => [unique('provider_abbreviation_key').on(table.abbreviation)]
);

export const userToProvider = pgTable(
	'user_to_provider',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'is_member_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		userId: text().notNull(),
		approved: boolean().default(false).notNull(),
		providerId: integer().notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: 'FK_userId'
		}),
		foreignKey({
			columns: [table.providerId],
			foreignColumns: [provider.id],
			name: 'FK_providerId'
		})
	]
);

export const category = pgTable(
	'category',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'category_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		name: text().notNull()
	},
	(table) => [unique('category_name_key').on(table.name)]
);

export const session = pgTable(
	'session',
	{
		id: text().primaryKey().notNull(),
		userId: text('user_id').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: 'session_user_id_user_id_fk'
		})
	]
);

export const categoryToIndicator = pgTable(
	'category_to_indicator',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'category_to_indicator_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		indicatorId: integer().notNull(),
		categoryId: integer().notNull(),
		necessity: indicatorNecessity().notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.indicatorId],
			foreignColumns: [indicator.id],
			name: 'FK_indicatorId'
		}),
		foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: 'FK_categoryId'
		})
	]
);

export const consortium = pgTable(
	'consortium',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'consortium_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		abbreviation: text().notNull(),
		name: text().notNull()
	},
	(table) => [unique('consortium_abbreviation_key').on(table.abbreviation)]
);

export const indicator = pgTable(
	'indicator',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'indicator_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		name: text().notNull(),
		description: text(),
		type: indicatorType(),
		category: indicatorCategory()
	},
	(table) => [unique('indicator_name_key').on(table.name)]
);

export const announcement = pgTable('announcement', {
	id: integer()
		.primaryKey()
		.generatedAlwaysAsIdentity({
			name: 'announcement_id_seq',
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: 2147483647,
			cache: 1
		}),
	from: text(),
	title: text(),
	message: text(),
	date: timestamp({ withTimezone: true, mode: 'string' })
});

export const consortiumToService = pgTable(
	'consortium_to_service',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'consortium_to_service_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		consortiumId: integer().notNull(),
		serviceId: integer()
	},
	(table) => [
		foreignKey({
			columns: [table.consortiumId],
			foreignColumns: [consortium.id],
			name: 'FK_consortiumId'
		}),
		foreignKey({
			columns: [table.serviceId],
			foreignColumns: [service.id],
			name: 'FK_serviceId'
		})
	]
);

export const serviceToIndicator = pgTable(
	'service_to_indicator',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'service_to_indicator_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		serviceId: integer('service_id').notNull(),
		indicatorId: integer('indicator_id').notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.serviceId],
			foreignColumns: [service.id],
			name: 'FK_serviceId'
		}),
		foreignKey({
			columns: [table.indicatorId],
			foreignColumns: [indicator.id],
			name: 'FK_indicatorId'
		})
	]
);

export const settings = pgTable(
	'settings',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'settings_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		key: text().notNull(),
		value: json()
	},
	(table) => [unique('settings_key_key').on(table.key)]
);

export const serviceForm = pgTable(
	'service_form',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'service_form_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		formData: json().array(),
		serviceName: text(),
		serviceId: integer(),
		additionalInfo: json(),
		maturityModel: text()
	},
	(table) => [
		foreignKey({
			columns: [table.serviceId],
			foreignColumns: [service.id],
			name: 'FK_serviceId'
		})
	]
);

export const evaluation = pgTable(
	'evaluation',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'evaluation_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		categoryId: integer(),
		indicatorId: integer(),
		aggregate: aggregateFunction()
	},
	(table) => [
		foreignKey({
			columns: [table.categoryId],
			foreignColumns: [category.id],
			name: 'FK_categoryId'
		}),
		foreignKey({
			columns: [table.indicatorId],
			foreignColumns: [indicator.id],
			name: 'FK_indicatorId'
		})
	]
);

export const apiLogs = pgTable(
	'api_logs',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'api_logs_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		method: apiMethod().notNull(),
		endpoint: text().notNull(),
		body: json(),
		query: text(),
		userId: text().notNull(),
		timestamp: text().notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: 'FK_userId'
		})
	]
);

export const authCodes = pgTable(
	'auth_codes',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'auth_codes_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		state: text().notNull(),
		provider: json()
	},
	(table) => [unique('auth_codes_state_key').on(table.state)]
);

export const providerToService = pgTable(
	'provider_to_service',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'provider_to_service_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		providerId: integer('provider_id').notNull(),
		serviceId: integer('service_id').notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.providerId],
			foreignColumns: [provider.id],
			name: 'FK_providerId'
		}),
		foreignKey({
			columns: [table.serviceId],
			foreignColumns: [service.id],
			name: 'FK_serviceId'
		})
	]
);

export const measurements = pgTable(
	'measurements',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'measurements_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		serviceId: integer('service_id').notNull(),
		indicatorId: integer('indicator_id').notNull(),
		date: text().notNull(),
		value: text().notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.serviceId],
			foreignColumns: [service.id],
			name: 'FK_serviceId'
		}),
		foreignKey({
			columns: [table.indicatorId],
			foreignColumns: [indicator.id],
			name: 'FK_indicatorId'
		})
	]
);

export const maturityModel = pgTable('maturity_model', {
	id: integer()
		.primaryKey()
		.generatedAlwaysAsIdentity({
			name: 'maturity_model_id_seq',
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: 2147483647,
			cache: 1
		}),
	topic: text(),
	levels: text().array(),
	name: text(),
	domain: text()
});

export const userToToken = pgTable(
	'user_to_token',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'user_to_token_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		userId: text(),
		tokenId: integer()
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: 'FK_userId'
		}),
		foreignKey({
			columns: [table.tokenId],
			foreignColumns: [token.id],
			name: 'FK_tokenId'
		})
	]
);

export const authenticationMethod = pgTable(
	'authentication_method',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'authentication_method_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		method: authMethod().default('local').notNull(),
		details: json(),
		userId: text('user_id').notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: 'FK_userId'
		})
	]
);

export const token = pgTable('token', {
	id: integer()
		.primaryKey()
		.generatedAlwaysAsIdentity({
			name: 'token_id_seq',
			startWith: 1,
			increment: 1,
			minValue: 1,
			maxValue: 2147483647,
			cache: 1
		}),
	hash: text(),
	lastUsed: text(),
	created: text(),
	name: text()
});

export const publication = pgTable(
	'publication',
	{
		id: integer()
			.primaryKey()
			.generatedAlwaysAsIdentity({
				name: 'publication_id_seq',
				startWith: 1,
				increment: 1,
				minValue: 1,
				maxValue: 2147483647,
				cache: 1
			}),
		doi: text().notNull(),
		title: text(),
		authors: text(),
		serviceId: integer(),
		publicationDate: text('publication_date')
	},
	(table) => [
		foreignKey({
			columns: [table.serviceId],
			foreignColumns: [service.id],
			name: 'FK_serviceId'
		})
	]
);
export const serviceView = pgView('service_view', {
	name: text(),
	icon: text(),
	abbreviation: text(),
	stage: serviceStage(),
	license: text(),
	category: text(),
	provider: json(),
	consortia: jsonb()
}).as(
	sql`WITH data AS ( SELECT DISTINCT service.name, service.icon, service.abbreviation, service.stage, service.license, category.name AS category, provider.name AS providername, provider.abbreviation AS providerabbreviation, consortium.name AS consortiumname, consortium.abbreviation AS consortiumabbreviation FROM category, service, provider_to_service, provider, consortium_to_service, consortium WHERE service.id = provider_to_service.service_id AND provider_to_service.provider_id = provider.id AND consortium_to_service."consortiumId" = consortium.id AND service.category = category.id ) SELECT name, icon, abbreviation, stage, license, category, json_build_object('name', providername, 'abbreviation', providerabbreviation) AS provider, COALESCE(jsonb_agg(json_build_object('name', consortiumname, 'abbreviation', consortiumabbreviation))) AS consortia FROM data GROUP BY abbreviation, name, icon, stage, license, category, providername, providerabbreviation`
);

export const userView = pgView('user_view', {
	id: text(),
	icon: text(),
	username: text(),
	email: text(),
	bio: text(),
	role: userRole(),
	providers: jsonb()
}).as(
	sql`SELECT u.id, u.icon, u.username, u.email, u.bio, u.role, COALESCE(jsonb_agg(jsonb_build_object('name', p.name, 'abbreviation', p.abbreviation, 'approved', utp.approved)) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) AS providers FROM "user" u LEFT JOIN user_to_provider utp ON u.id = utp."userId" LEFT JOIN provider p ON utp."providerId" = p.id GROUP BY u.id`
);
