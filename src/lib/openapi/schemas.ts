/**
 * @swagger
 * components:
 *   schemas:
 *    CategoryResponse:
 *      type: object
 *      required:
 *       - metadata
 *       - result
 *      properties:
 *        metadata:
 *         type: object
 *         required:
 *          - currentPage
 *          - pageSize
 *          - totalPages
 *          - totalCount
 *         properties:
 *           currentPage:
 *             type: integer
 *             description: Current page number
 *           pageSize:
 *             type: integer
 *             description: Number of items per page
 *           totalPages:
 *             type: integer
 *             description: Total number of pages
 *           totalCount:
 *             type: integer
 *             description: Total number of items
 *        result:
 *          type: array
 *          items:
 *            $ref: '#/components/schemas/Category'
 *            description: Array of items of type T
 *    KPIResponse:
 *      type: object
 *      required:
 *       - metadata
 *       - result
 *      properties:
 *        metadata:
 *         type: object
 *         required:
 *          - currentPage
 *          - pageSize
 *          - totalPages
 *          - totalCount
 *         properties:
 *           currentPage:
 *             type: integer
 *             description: Current page number
 *           pageSize:
 *             type: integer
 *             description: Number of items per page
 *           totalPages:
 *             type: integer
 *             description: Total number of pages
 *           totalCount:
 *             type: integer
 *             description: Total number of items
 *        result:
 *          type: array
 *          items:
 *            $ref: '#/components/schemas/Indicator'
 *            description: Array of items of type T
 *    MeasurementResponse:
 *      type: object
 *      required:
 *       - metadata
 *       - result
 *      properties:
 *        metadata:
 *         type: object
 *         required:
 *          - currentPage
 *          - pageSize
 *          - totalPages
 *          - totalCount
 *         properties:
 *           currentPage:
 *             type: integer
 *             description: Current page number
 *           pageSize:
 *             type: integer
 *             description: Number of items per page
 *           totalPages:
 *             type: integer
 *             description: Total number of pages
 *           totalCount:
 *             type: integer
 *             description: Total number of items
 *        result:
 *          type: array
 *          items:
 *            $ref: '#/components/schemas/Measurement'
 *            description: Array of items of type T
 *    ProviderResponse:
 *      type: object
 *      required:
 *       - metadata
 *       - result
 *      properties:
 *        metadata:
 *         type: object
 *         required:
 *          - currentPage
 *          - pageSize
 *          - totalPages
 *          - totalCount
 *         properties:
 *           currentPage:
 *             type: integer
 *             description: Current page number
 *           pageSize:
 *             type: integer
 *             description: Number of items per page
 *           totalPages:
 *             type: integer
 *             description: Total number of pages
 *           totalCount:
 *             type: integer
 *             description: Total number of items
 *        result:
 *          type: array
 *          items:
 *            $ref: '#/components/schemas/Provider'
 *            description: Array of items of type T
 *    ServiceResponse:
 *      type: object
 *      required:
 *       - metadata
 *       - result
 *      properties:
 *        metadata:
 *         type: object
 *         required:
 *          - currentPage
 *          - pageSize
 *          - totalPages
 *          - totalCount
 *         properties:
 *           currentPage:
 *             type: integer
 *             description: Current page number
 *           pageSize:
 *             type: integer
 *             description: Number of items per page
 *           totalPages:
 *             type: integer
 *             description: Total number of pages
 *           totalCount:
 *             type: integer
 *             description: Total number of items
 *        result:
 *          type: array
 *          items:
 *            $ref: '#/components/schemas/Service'
 *            description: Array of items of type T
 */
export type Response<T> = {
	metadata: {
		currentPage: number;
		pageSize: number;
		totalPages: number;
		totalCount: number;
	};
	result: Array<T>;
};

export type User = {
	id: string;
	username: string;
	role: string;
	approved: boolean;
	providers?: { abbreviation: string; name: string; approved: boolean }[];
	email?: string;
	bio?: string;
	icon?: string;
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Category:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           description: Full category name
 */
export type Category = {
	name: string;
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Indicator:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           description: Full indicator name
 *         description:
 *           type: string
 *           description: Description of the indicator
 *         selected:
 *           type: boolean
 *           description: Whether the indicator is selected for display
 *         categories:
 *           type: array
 *           items:
 *             type: object
 *             required:
 *               - name
 *               - necessity
 *             properties:
 *               name:
 *                 type: string
 *               necessity:
 *                 type: string
 */
export type Indicator = {
	name: string;
	description: string | null;
	categories: { name: string; necessity: string }[];
	selected: boolean;
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Measurement:
 *       type: object
 *       required:
 *         - kpi
 *         - date
 *         - value
 *       properties:
 *         kpi:
 *           type: string
 *           description: KPI abbreviation
 *         date:
 *           type: string
 *           format: datetime
 *           description: Date of the measurement
 *         value:
 *           type: number
 *           description: Value of the measurement
 */
export type Measurement = {
	kpi: string;
	date: string;
	value: number;
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Provider:
 *       type: object
 *       required:
 *         - abbreviation
 *         - name
 *       properties:
 *         abbreviation:
 *           type: string
 *           description: Provider abbreviation
 *         name:
 *           type: string
 *           description: Provider name
 */
export type Provider = {
	abbreviation: string;
	name: string;
};

/**
 * @swagger
 * components:
 *   schemas:
 *     Service:
 *       type: object
 *       required:
 *         - abbreviation
 *         - name
 *         - category
 *         - provider
 *         - license
 *         - consortia
 *         - stage
 *       properties:
 *         abbreviation:
 *           type: string
 *           description: Service abbreviation
 *         name:
 *           type: string
 *           description: Service name
 *         category:
 *           type: string
 *           description: Service category
 *         provider:
 *           type: string
 *           description: Service provider
 *         license:
 *           type: string
 *           description: Service license
 *         consortia:
 *           type: array
 *           items:
 *             type: object
 *             required:
 *               - abbreviation
 *               - name
 *             properties:
 *               abbreviation:
 *                 type: string
 *               name:
 *                 type: string
 *           description: List of consortia associated with the service
 *         stage:
 *           type: string
 *           description: Service stage
 */
export type Service = {
	abbreviation: string;
	name: string;
	category: string;
	provider: string; //{ abbreviation: string; name: string };
	license: string;
	consortia: { abbreviation: string; name: string }[];
	stage: string;
};

/**
 * @swagger
 *  components:
 *    securitySchemes:
 *     ApiKeyAuth:
 *       type: apiKey
 *       in: header
 *       name: X-API-Key
 */
