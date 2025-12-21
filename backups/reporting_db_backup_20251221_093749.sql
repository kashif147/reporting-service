--
-- PostgreSQL database dump
--

\restrict 9JzUzXoKvc8kDi53kwWdFLDHZXqay4E1dVGsOz1FHEu3sKuYqHhJWIEyU2aU2YJ

-- Dumped from database version 16.11 (Debian 16.11-1.pgdg13+1)
-- Dumped by pg_dump version 16.11 (Debian 16.11-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

DROP DATABASE IF EXISTS reporting_db;
--
-- Name: reporting_db; Type: DATABASE; Schema: -; Owner: reports_admin
--

CREATE DATABASE reporting_db WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'en_US.utf8';


ALTER DATABASE reporting_db OWNER TO reports_admin;

\unrestrict 9JzUzXoKvc8kDi53kwWdFLDHZXqay4E1dVGsOz1FHEu3sKuYqHhJWIEyU2aU2YJ
\connect reporting_db
\restrict 9JzUzXoKvc8kDi53kwWdFLDHZXqay4E1dVGsOz1FHEu3sKuYqHhJWIEyU2aU2YJ

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: reports; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA reports;


ALTER SCHEMA reports OWNER TO pg_database_owner;

--
-- Name: SCHEMA reports; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA reports IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: category_paying_type; Type: TABLE; Schema: reports; Owner: reports_admin
--

CREATE TABLE reports.category_paying_type (
    category text NOT NULL,
    paying_type text NOT NULL
);


ALTER TABLE reports.category_paying_type OWNER TO reports_admin;

--
-- Name: members; Type: TABLE; Schema: reports; Owner: reports_admin
--

CREATE TABLE reports.members (
    member_id text NOT NULL,
    category text,
    paying_type text,
    grade text,
    section text,
    workplace_id integer
);


ALTER TABLE reports.members OWNER TO reports_admin;

--
-- Name: membership_activity; Type: TABLE; Schema: reports; Owner: reports_admin
--

CREATE TABLE reports.membership_activity (
    event_date date NOT NULL,
    event_id text NOT NULL,
    member_id text NOT NULL,
    event_type text NOT NULL,
    region_name text,
    branch_name text,
    workplace_name text,
    iro_name text,
    branch_officer text,
    regional_manager text,
    category text,
    paying_type text,
    grade text,
    section text,
    status text
);


ALTER TABLE reports.membership_activity OWNER TO reports_admin;

--
-- Name: membership_snapshot; Type: TABLE; Schema: reports; Owner: reports_admin
--

CREATE TABLE reports.membership_snapshot (
    snapshot_date date NOT NULL,
    member_id text NOT NULL,
    region_name text,
    branch_name text,
    workplace_name text,
    iro_name text,
    branch_officer text,
    regional_manager text,
    category text,
    paying_type text,
    grade text,
    section text,
    status text
);


ALTER TABLE reports.membership_snapshot OWNER TO reports_admin;

--
-- Name: mv_category_distribution; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_category_distribution AS
 SELECT category,
    count(*) AS member_count
   FROM reports.membership_snapshot
  WHERE (snapshot_date = ( SELECT max(membership_snapshot_1.snapshot_date) AS max
           FROM reports.membership_snapshot membership_snapshot_1))
  GROUP BY category
  ORDER BY (count(*)) DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_category_distribution OWNER TO reports_admin;

--
-- Name: mv_grade_distribution; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_grade_distribution AS
 SELECT grade,
    count(*) AS member_count
   FROM reports.membership_snapshot
  WHERE (snapshot_date = ( SELECT max(membership_snapshot_1.snapshot_date) AS max
           FROM reports.membership_snapshot membership_snapshot_1))
  GROUP BY grade
  ORDER BY (count(*)) DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_grade_distribution OWNER TO reports_admin;

--
-- Name: mv_joiners; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_joiners AS
 SELECT (date_trunc('month'::text, (event_date)::timestamp with time zone))::date AS month,
    count(*) AS joiner_count
   FROM reports.membership_activity
  WHERE (event_type = ANY (ARRAY['NEW'::text, 'JOINER'::text, 'REINSTATE'::text]))
  GROUP BY ((date_trunc('month'::text, (event_date)::timestamp with time zone))::date)
  ORDER BY ((date_trunc('month'::text, (event_date)::timestamp with time zone))::date)
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_joiners OWNER TO reports_admin;

--
-- Name: mv_leavers; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_leavers AS
 SELECT (date_trunc('month'::text, (event_date)::timestamp with time zone))::date AS month,
    count(*) AS leaver_count
   FROM reports.membership_activity
  WHERE (event_type = ANY (ARRAY['CANCELLED'::text, 'RESIGNED'::text]))
  GROUP BY ((date_trunc('month'::text, (event_date)::timestamp with time zone))::date)
  ORDER BY ((date_trunc('month'::text, (event_date)::timestamp with time zone))::date)
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_leavers OWNER TO reports_admin;

--
-- Name: mv_membership_counts; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_membership_counts AS
 SELECT snapshot_date,
    count(*) AS total_members,
    count(*) FILTER (WHERE (status = 'Active'::text)) AS active_members,
    count(*) FILTER (WHERE (status = 'Suspended'::text)) AS suspended_members
   FROM reports.membership_snapshot
  GROUP BY snapshot_date
  ORDER BY snapshot_date
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_membership_counts OWNER TO reports_admin;

--
-- Name: mv_net_membership; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_net_membership AS
 SELECT COALESCE(j.month, l.month) AS month,
    (COALESCE(j.joiner_count, (0)::bigint) - COALESCE(l.leaver_count, (0)::bigint)) AS net_change
   FROM (reports.mv_joiners j
     FULL JOIN reports.mv_leavers l ON ((j.month = l.month)))
  ORDER BY COALESCE(j.month, l.month)
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_net_membership OWNER TO reports_admin;

--
-- Name: mv_region_branch_summary; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_region_branch_summary AS
 SELECT region_name,
    branch_name,
    count(*) AS total_members,
    count(*) FILTER (WHERE (status = 'Active'::text)) AS active_members
   FROM reports.membership_snapshot
  WHERE (snapshot_date = ( SELECT max(membership_snapshot_1.snapshot_date) AS max
           FROM reports.membership_snapshot membership_snapshot_1))
  GROUP BY region_name, branch_name
  ORDER BY region_name, branch_name
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_region_branch_summary OWNER TO reports_admin;

--
-- Name: mv_section_distribution; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_section_distribution AS
 SELECT section,
    count(*) AS member_count
   FROM reports.membership_snapshot
  WHERE (snapshot_date = ( SELECT max(membership_snapshot_1.snapshot_date) AS max
           FROM reports.membership_snapshot membership_snapshot_1))
  GROUP BY section
  ORDER BY (count(*)) DESC
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_section_distribution OWNER TO reports_admin;

--
-- Name: mv_workplace_summary; Type: MATERIALIZED VIEW; Schema: reports; Owner: reports_admin
--

CREATE MATERIALIZED VIEW reports.mv_workplace_summary AS
 SELECT workplace_name,
    branch_name,
    region_name,
    iro_name,
    count(*) AS total_members,
    count(*) FILTER (WHERE (status = 'Active'::text)) AS active_members,
    count(*) FILTER (WHERE (status = 'Suspended'::text)) AS suspended_members
   FROM reports.membership_snapshot
  WHERE (snapshot_date = ( SELECT max(membership_snapshot_1.snapshot_date) AS max
           FROM reports.membership_snapshot membership_snapshot_1))
  GROUP BY workplace_name, branch_name, region_name, iro_name
  ORDER BY region_name, branch_name, workplace_name
  WITH NO DATA;


ALTER MATERIALIZED VIEW reports.mv_workplace_summary OWNER TO reports_admin;

--
-- Name: reporting_workplaces; Type: TABLE; Schema: reports; Owner: reports_admin
--

CREATE TABLE reports.reporting_workplaces (
    workplace_id integer NOT NULL,
    workplace_name text NOT NULL,
    branch_name text NOT NULL,
    region_name text NOT NULL,
    iro_name text,
    branch_officer text,
    regional_manager text
);


ALTER TABLE reports.reporting_workplaces OWNER TO reports_admin;

--
-- Name: reporting_workplaces_workplace_id_seq; Type: SEQUENCE; Schema: reports; Owner: reports_admin
--

CREATE SEQUENCE reports.reporting_workplaces_workplace_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE reports.reporting_workplaces_workplace_id_seq OWNER TO reports_admin;

--
-- Name: reporting_workplaces_workplace_id_seq; Type: SEQUENCE OWNED BY; Schema: reports; Owner: reports_admin
--

ALTER SEQUENCE reports.reporting_workplaces_workplace_id_seq OWNED BY reports.reporting_workplaces.workplace_id;


--
-- Name: reporting_workplaces workplace_id; Type: DEFAULT; Schema: reports; Owner: reports_admin
--

ALTER TABLE ONLY reports.reporting_workplaces ALTER COLUMN workplace_id SET DEFAULT nextval('reports.reporting_workplaces_workplace_id_seq'::regclass);


--
-- Data for Name: category_paying_type; Type: TABLE DATA; Schema: reports; Owner: reports_admin
--

COPY reports.category_paying_type (category, paying_type) FROM stdin;
General (all grades)	Full fee
Postgraduate Student	Full fee
Private nursing home	Full fee
Short-term/Relief (under 12 hrs/wk average)	Full fee
Affiliate members (non-practicing)	Reduced fee
Lecturing (employed in universities and IT institutes)	Full fee
Associate (not currently employed as a nurse/midwife)	Reduced fee
Retired Associate	Retired fee
Undergraduate Student	No fee
Honorary	No fee
\.


--
-- Data for Name: members; Type: TABLE DATA; Schema: reports; Owner: reports_admin
--

COPY reports.members (member_id, category, paying_type, grade, section, workplace_id) FROM stdin;
MEM00001	General (all grades)	Full fee	Staff Nurse	General	1
MEM00002	Associate (not currently employed as a nurse/midwife)	Reduced fee	Retired Nurse/Midwife	Retired Associate	2
MEM00003	Postgraduate Student	Full fee	Student Nurse	Student Section	3
MEM00004	Private nursing home	Full fee	Senior Staff Nurse	Older Person Care	5
MEM00005	Short-term/Relief (under 12 hrs/wk average)	Full fee	Staff Midwife	Midwives Section	1
MEM00006	Retired Associate	Retired fee	Retired Nurse/Midwife	Retired Associate	4
MEM00007	Undergraduate Student	No fee	Student Midwife	Student Section	2
MEM00008	Lecturing (employed in universities and IT institutes)	Full fee	Nurse Tutor	Nurse/Midwife Education Sect	3
MEM00009	Affiliate members (non-practicing)	Reduced fee	Associate	Associate Section	5
MEM00010	Honorary	No fee	Honorary	General	1
\.


--
-- Data for Name: membership_activity; Type: TABLE DATA; Schema: reports; Owner: reports_admin
--

COPY reports.membership_activity (event_date, event_id, member_id, event_type, region_name, branch_name, workplace_name, iro_name, branch_officer, regional_manager, category, paying_type, grade, section, status) FROM stdin;
2024-01-02	ACT001	MEM00003	JOINER	Western	Galway	University Hospital Galway	Melissa Hayes	Aisling Hayes	Caroline Forde	Postgraduate Student	Full fee	Student Nurse	Student Section	Active
2024-02-10	ACT002	MEM00006	SUSPENDED	North West	Donegal	Letterkenny University Hospital	Kevin McGrath	Sean Murphy	Anne Gallagher	Retired Associate	Retired fee	Retired Nurse/Midwife	Retired Associate	Suspended
2024-03-12	ACT003	MEM00009	REINSTATE	Southern	Cork	CUH - Cork University Hospital	Rachel Connolly	Fiona O’Brien	Helen Murphy	Affiliate members (non-practicing)	Reduced fee	Associate	Associate Section	Active
2024-03-20	ACT004	MEM00005	CANCELLED	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	Short-term/Relief (under 12 hrs/wk average)	Full fee	Staff Midwife	Midwives Section	Inactive
2024-03-25	ACT005	MEM00001	RESIGNED	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	General (all grades)	Full fee	Staff Nurse	General	Inactive
2024-03-26	ACT006	MEM00004	SUSPENDED	Southern	Cork	CUH - Cork University Hospital	Rachel Connolly	Fiona O’Brien	Helen Murphy	Private nursing home	Full fee	Senior Staff Nurse	Older Person Care	Suspended
2024-03-29	ACT007	MEM00002	JOINER	Eastern	Dublin North	Beaumont Hospital	Gerard Walsh	Emma Ryan	Sarah Donnelly	Associate (not currently employed as a nurse/midwife)	Reduced fee	Retired Nurse/Midwife	Retired Associate	Active
2024-03-30	ACT008	MEM00008	JOINER	Western	Galway	University Hospital Galway	Melissa Hayes	Aisling Hayes	Caroline Forde	Lecturing (employed in universities and IT institutes)	Full fee	Nurse Tutor	Nurse/Midwife Education Sect	Active
2024-03-30	ACT009	MEM00010	JOINER	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	Honorary	No fee	Honorary	General	Active
2024-03-31	ACT010	MEM00007	CANCELLED	Eastern	Dublin North	Beaumont Hospital	Gerard Walsh	Emma Ryan	Sarah Donnelly	Undergraduate Student	No fee	Student Midwife	Student Section	Inactive
\.


--
-- Data for Name: membership_snapshot; Type: TABLE DATA; Schema: reports; Owner: reports_admin
--

COPY reports.membership_snapshot (snapshot_date, member_id, region_name, branch_name, workplace_name, iro_name, branch_officer, regional_manager, category, paying_type, grade, section, status) FROM stdin;
2024-01-01	MEM00001	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	General (all grades)	Full fee	Staff Nurse	General	Active
2024-01-01	MEM00002	Eastern	Dublin North	Beaumont Hospital	Gerard Walsh	Emma Ryan	Sarah Donnelly	Associate (not currently employed as a nurse/midwife)	Reduced fee	Retired Nurse/Midwife	Retired Associate	Active
2024-01-01	MEM00003	Western	Galway	University Hospital Galway	Melissa Hayes	Aisling Hayes	Caroline Forde	Postgraduate Student	Full fee	Student Nurse	Student Section	Active
2024-01-01	MEM00004	Southern	Cork	CUH - Cork University Hospital	Rachel Connolly	Fiona O’Brien	Helen Murphy	Private nursing home	Full fee	Senior Staff Nurse	Older Person Care	Active
2024-01-01	MEM00005	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	Short-term/Relief (under 12 hrs/wk average)	Full fee	Staff Midwife	Midwives Section	Active
2024-01-01	MEM00006	North West	Donegal	Letterkenny University Hospital	Kevin McGrath	Sean Murphy	Anne Gallagher	Retired Associate	Retired fee	Retired Nurse/Midwife	Retired Associate	Active
2024-01-01	MEM00007	Eastern	Dublin North	Beaumont Hospital	Gerard Walsh	Emma Ryan	Sarah Donnelly	Undergraduate Student	No fee	Student Midwife	Student Section	Active
2024-01-01	MEM00008	Western	Galway	University Hospital Galway	Melissa Hayes	Aisling Hayes	Caroline Forde	Lecturing (employed in universities and IT institutes)	Full fee	Nurse Tutor	Nurse/Midwife Education Sect	Active
2024-01-01	MEM00009	Southern	Cork	CUH - Cork University Hospital	Rachel Connolly	Fiona O’Brien	Helen Murphy	Affiliate members (non-practicing)	Reduced fee	Associate	Associate Section	Active
2024-01-01	MEM00010	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	Honorary	No fee	Honorary	General	Active
2024-02-01	MEM00001	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	General (all grades)	Full fee	Staff Nurse	General	Active
2024-02-01	MEM00002	Eastern	Dublin North	Beaumont Hospital	Gerard Walsh	Emma Ryan	Sarah Donnelly	Associate (not currently employed as a nurse/midwife)	Reduced fee	Retired Nurse/Midwife	Retired Associate	Active
2024-03-01	MEM00001	Eastern	Dublin South	St Vincent's University Hospital	Jennifer Doyle	Alan Roche	Sarah Donnelly	General (all grades)	Full fee	Staff Nurse	General	Suspended
\.


--
-- Data for Name: reporting_workplaces; Type: TABLE DATA; Schema: reports; Owner: reports_admin
--

COPY reports.reporting_workplaces (workplace_id, workplace_name, branch_name, region_name, iro_name, branch_officer, regional_manager) FROM stdin;
1	St Vincent's University Hospital	Dublin South	Eastern	Jennifer Doyle	Alan Roche	Sarah Donnelly
2	Beaumont Hospital	Dublin North	Eastern	Gerard Walsh	Emma Ryan	Sarah Donnelly
3	University Hospital Galway	Galway	Western	Melissa Hayes	Aisling Hayes	Caroline Forde
4	Letterkenny University Hospital	Donegal	North West	Kevin McGrath	Sean Murphy	Anne Gallagher
5	CUH - Cork University Hospital	Cork	Southern	Rachel Connolly	Fiona O’Brien	Helen Murphy
\.


--
-- Name: reporting_workplaces_workplace_id_seq; Type: SEQUENCE SET; Schema: reports; Owner: reports_admin
--

SELECT pg_catalog.setval('reports.reporting_workplaces_workplace_id_seq', 5, true);


--
-- Name: category_paying_type category_paying_type_pkey; Type: CONSTRAINT; Schema: reports; Owner: reports_admin
--

ALTER TABLE ONLY reports.category_paying_type
    ADD CONSTRAINT category_paying_type_pkey PRIMARY KEY (category);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: reports; Owner: reports_admin
--

ALTER TABLE ONLY reports.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (member_id);


--
-- Name: membership_activity membership_activity_pkey; Type: CONSTRAINT; Schema: reports; Owner: reports_admin
--

ALTER TABLE ONLY reports.membership_activity
    ADD CONSTRAINT membership_activity_pkey PRIMARY KEY (event_id);


--
-- Name: reporting_workplaces reporting_workplaces_pkey; Type: CONSTRAINT; Schema: reports; Owner: reports_admin
--

ALTER TABLE ONLY reports.reporting_workplaces
    ADD CONSTRAINT reporting_workplaces_pkey PRIMARY KEY (workplace_id);


--
-- Name: members members_workplace_id_fkey; Type: FK CONSTRAINT; Schema: reports; Owner: reports_admin
--

ALTER TABLE ONLY reports.members
    ADD CONSTRAINT members_workplace_id_fkey FOREIGN KEY (workplace_id) REFERENCES reports.reporting_workplaces(workplace_id);


--
-- Name: mv_category_distribution; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_category_distribution;


--
-- Name: mv_grade_distribution; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_grade_distribution;


--
-- Name: mv_joiners; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_joiners;


--
-- Name: mv_leavers; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_leavers;


--
-- Name: mv_membership_counts; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_membership_counts;


--
-- Name: mv_net_membership; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_net_membership;


--
-- Name: mv_region_branch_summary; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_region_branch_summary;


--
-- Name: mv_section_distribution; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_section_distribution;


--
-- Name: mv_workplace_summary; Type: MATERIALIZED VIEW DATA; Schema: reports; Owner: reports_admin
--

REFRESH MATERIALIZED VIEW reports.mv_workplace_summary;


--
-- PostgreSQL database dump complete
--

\unrestrict 9JzUzXoKvc8kDi53kwWdFLDHZXqay4E1dVGsOz1FHEu3sKuYqHhJWIEyU2aU2YJ

