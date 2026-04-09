# TODO

Codex
- [x] Rename app to Applix
- [x] create new logo
- [x] Allow applications to be deleted from the applications table
- [x] Add multi-select for delete and multi-mark-as-applied in applications table
- [x] Make the text, the job title text, and the badge on status columns horizontally aligned in the applications table. 
- [] In the extraction some ex some sections are not being grabbed just a job to description. I want to grab the entire description in the job description. Example Accenture. Not just grab the job description part. I wante tod grab the qualifications everything about the j job also even grab the salary if it's provided I think that should be a new field as part of the application. We need to do a schema change. add add the things that will change in the configuration when the user is selecting low, medium, high so that they know exactly what is what will be affected If it's too much information to put, make the configuration card smaller with a tooltip that shows all the details. 
- [] In the aggressiveness high, I wanted to even change the professional experience titles. Not the dates of the titles, but the actual title name to change it to match whatever experience that I'm putting in. low and medium mode do not touch the titles of any of my roles Uh 
- [x] Add a delete button in the applications table in the action column and add a delete button on the application details page Next to the export PDF button.
- [x] Add a way to delete There are sometimes there are extractions that are cute that are stuck in that state forever so I need a way to stop the extraction so that it can be deleted force stop the extraction. 
- [x] too many lines on the dashbaord move things around?
- [] saving profile changes - fails with 500 also make the e-mail
- [x] Align filters on applications table with the search bar
- [] Only create draft/application if URL is provided; don't create if closed with no input
- [x] The next fix I’d make is to hard-block generation/regeneration when the stored job data looks like blocked-source placeholder text, and route the app back to manual-entry recovery instead.
- [x] Update login page to reflect current UI state

Opus
- [x] Add breadcrumb ("Home") to dashboard page it looks empty "Home"
- [x] Replace "Applied" checkbox with a button at end of table to toggle applied status
- [x] Add confirmation modal when marking application as applied
- [x] Make resume markdown editing mode look prettier (add styling)
- [x] Make base resume editor markdown form look prettier
- [x] Add toast notifications for: application creation, deletion, etc
- [x] On bigger screens the ui is only taking up a small section of the page, make all the pages responsive in smaller and bigger screens

- [x] Various UI improvements in application detail page
