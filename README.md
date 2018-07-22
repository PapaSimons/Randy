Welcome (my son) to the Habit Machine!

This project has a tensorflow model that recognises and learns Habits and nodejs server app that runs the Habit Machine UI.

# Starting to use:

Install Docker from [here](https://docs.docker.com/install/)
Clone this repository into a directory on your computer and CD into that directory

Build the containter: 

```sh
docker-compose build
```

# Development:

Run the container:
```sh
docker-compose up
```

Run the container:
```sh
docker-compose exec habitsdev sh
```

# Deployment:

Inside the project directory run:

```sh
docker-compose -f deploy.yml build
```

Contact: Nitin or Gideon for any questions

   _______________               
  |  ___________  |   
  | |           | |  
  | |   0   0   | | 
  | |     -     | |     
  | |   \___/   | |     
  | |___     ___| |   
  |_____|\_/|_____|    
    _|__|/ \|_|_
   / ********** \                       
 /  ************  \                    
--------------------      