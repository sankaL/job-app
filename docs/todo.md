# TODO

Codex
- [x] Rename app to Applix
- [x] create new logo
- [x] Allow applications to be deleted from the applications table
- [x] Add multi-select for delete and multi-mark-as-applied in applications table
- [x] Make the text, the job title text, and the badge on status columns horizontally aligned in the applications table. 
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


- [x] In the extraction some some sections are not being grabbed just a job to description. I want to grab the entire description in the job description. Example Accenture. Not just grab the job description part. I wante tod grab the qualifications everything about the j job also even grab the salary if it's provided I think that should be a new field as part of the application. We need to do a schema change. 
- [x] add the things that will change in the configuration when the user is selecting low, medium, high so that they know exactly what is what will be affected If it's too much information to put, make the configuration card smaller with a tooltip that shows all the details. 
- [x] In the aggressiveness high, I wanted to even change the professional experience titles. Not the dates of the titles, but the actual title name to change it to match whatever experience that I'm putting in. low and medium mode do not touch the titles of any of my roles 

- [x] fix the resume output pdf issues - too small now use the latest example. make the job experience bold on pdf.
- [x] Add sign up flow when only invite only. Where is the invite triggered and what is the flow to sign up for new users and make their account and then log in. Test that out before launch. z-ai/glm-5.1 or 

- [x] seems like companies are striped away from the experience section - test first before fixing to see if its one off thing - maybe change modal
- [] Create a test suite integration in pytest with reporting request library - i make the scenarios sanity test suite


ERROR WHEN DOING HIGH AGRESSIVE GEN - app thought model was too slow.


                 ^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/tasks.py", line 519, in wait_for

    async with timeouts.timeout(timeout):

               ^^^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/timeouts.py", line 115, in __aexit__

    raise TimeoutError from exc_val

TimeoutError

17:14:38: 240.47s ! bea6f29790fb4fb5a620000e7b473ee3:run_regeneration_job failed, TimeoutError: 

Traceback (most recent call last):

  File "/usr/local/lib/python3.12/asyncio/tasks.py", line 520, in wait_for

    return await fut

           ^^^^^^^^^

  File "/usr/local/lib/python3.12/site-packages/generation.py", line 943, in generate_sections

    payload, model_used = await _await_with_progress_heartbeat(

                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/site-packages/generation.py", line 828, in _await_with_progress_heartbeat

    done, _pending = await asyncio.wait({task}, timeout=heartbeat_interval)

                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/tasks.py", line 464, in wait

    return await _wait(fs, timeout, return_when, loop)

           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/tasks.py", line 550, in _wait

    await waiter

asyncio.exceptions.CancelledError


The above exception was the direct cause of the following exception:


Traceback (most recent call last):

  File "/usr/local/lib/python3.12/site-packages/arq/worker.py", line 595, in run_job

    result = await asyncio.wait_for(task, timeout_s)

             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/tasks.py", line 520, in wait_for

    return await fut

           ^^^^^^^^^

  File "/usr/local/lib/python3.12/site-packages/worker.py", line 1132, in run_regeneration_job

    gen_result = await asyncio.wait_for(

                 ^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/tasks.py", line 519, in wait_for

    async with timeouts.timeout(timeout):

               ^^^^^^^^^^^^^^^^^^^^^^^^^

  File "/usr/local/lib/python3.12/asyncio/timeouts.py", line 115, in __aexit__

    raise TimeoutError from exc_val

TimeoutError
